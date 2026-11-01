import os
import json
import base64
import re
import uuid
import hashlib
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes, hmac
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from sqlalchemy import text
from titan_vault.database import SessionLocal, Token, Secret, AuditLog, TransitKey, init_db

_SEAL_CHECK = b"titan-seal-v1"
# Keep in sync with titan-vault-node src/core/classify.ts.
# DATABASE_URL is configuration. Only password fields are database credentials.
_DB_PASSWORD_RE = re.compile(
    r"(DB_PASS|POSTGRES_PASS|MYSQL_PASS|DB_PASSWORD|POSTGRES_PASSWORD|MYSQL_PASSWORD)",
    re.IGNORECASE,
)
_CRYPTO_RE = re.compile(r"(JWT|SECRET|KEY|PRIVATE|TOKEN|SALT)", re.IGNORECASE)


def _classify_key(key: str, bait_key: str) -> str:
    if key == bait_key:
        return "honeytoken"
    if _DB_PASSWORD_RE.search(key):
        return "database"
    if _CRYPTO_RE.search(key):
        return "crypto"
    return "config"


class VaultCore:
    _instance = None
    
    def __init__(self):
        self.fernet = None
        data_dir = os.environ.get("VAULT_DATA_DIR", ".")
        os.makedirs(data_dir, exist_ok=True)
        self.salt_file = os.path.join(data_dir, "vault.salt")
        self.verifier_file = os.path.join(data_dir, "vault.verifier")
        init_db()
        self._ensure_salt()
        self._migrate_plaintext_tokens()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _ensure_salt(self):
        if os.path.exists(self.salt_file):
            return
        db = SessionLocal()
        try:
            has_secrets = db.query(Secret).first() is not None
        except Exception:
            has_secrets = False
        finally:
            db.close()
        if has_secrets:
            return
        with open(self.salt_file, "wb") as f:
            f.write(os.urandom(16))

    def _audit_actor(self, token_id: str = None) -> str:
        if not token_id or token_id == "SYSTEM":
            return "SYSTEM"
        return self.token_accessor(token_id)

    def _log_audit(self, action: str, resource: str, status: str, token_id: str = None):
        db = SessionLocal()
        log = AuditLog(
            token_id=self._audit_actor(token_id),
            action=action,
            resource=resource,
            status=status,
        )
        db.add(log)
        db.commit()
        db.close()

    def is_sealed(self):
        return self.fernet is None

    def has_existing_data(self):
        if os.path.exists(self.verifier_file):
            return True
        return bool(self._ciphertext_blobs())

    @staticmethod
    def token_digest(token_id: str) -> str:
        return hashlib.sha256(token_id.encode()).hexdigest()

    @staticmethod
    def token_accessor(token_id: str) -> str:
        return VaultCore.token_digest(token_id)[:20]

    @staticmethod
    def _is_hex(value: str, length: int) -> bool:
        if not value or len(value) != length:
            return False
        try:
            int(value, 16)
        except ValueError:
            return False
        return True

    @classmethod
    def accessor_from_stored(cls, stored_id: str) -> str:
        if cls._is_hex(stored_id, 64):
            return stored_id[:20]
        return cls.token_accessor(stored_id)

    def _ciphertext_blobs(self) -> list:
        db = SessionLocal()
        try:
            secrets = db.query(Secret.encrypted_value).all()
            transit = db.query(TransitKey.encrypted_key).all()
        finally:
            db.close()
        return [row[0] for row in secrets] + [row[0] for row in transit]

    def _password_opens_vault(self, fernet) -> tuple:
        blobs = self._ciphertext_blobs()
        if not blobs:
            return True, False
        for blob in blobs:
            try:
                fernet.decrypt((blob or "").strip().encode())
            except Exception:
                return False, True
        return True, True

    def _verifier_matches(self, fernet) -> bool:
        try:
            with open(self.verifier_file, "rb") as handle:
                blob = handle.read()
            return fernet.decrypt(blob) == _SEAL_CHECK
        except Exception:
            return False

    def _write_verifier(self, fernet) -> None:
        payload = fernet.encrypt(_SEAL_CHECK)
        temporary = self.verifier_file + ".tmp"
        with open(temporary, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self.verifier_file)

    def _migrate_plaintext_tokens(self) -> None:
        db = SessionLocal()
        try:
            rows = db.execute(text("SELECT id FROM tokens")).fetchall()
            for row in rows:
                raw = row[0]
                if not raw or self._is_hex(raw, 64):
                    continue
                digest = self.token_digest(raw)
                db.execute(
                    text("UPDATE tokens SET id = :digest WHERE id = :raw"),
                    {"digest": digest, "raw": raw},
                )
            logs = db.execute(text("SELECT id, token_id, resource FROM audit_logs")).fetchall()
            for row in logs:
                actor = row[1] or ""
                resource = row[2] or ""
                new_actor = actor
                new_resource = resource
                if actor and actor != "SYSTEM" and not self._is_hex(actor, 20):
                    new_actor = self.token_accessor(actor)
                if resource.startswith("mv."):
                    new_resource = self.token_accessor(resource)
                if new_actor != actor or new_resource != resource:
                    db.execute(
                        text("UPDATE audit_logs SET token_id = :actor, resource = :resource WHERE id = :id"),
                        {"actor": new_actor, "resource": new_resource, "id": row[0]},
                    )
            db.commit()
        finally:
            db.close()

    def unseal(self, master_password: str):
        if not os.path.exists(self.salt_file):
            db = SessionLocal()
            try:
                has_secrets = db.query(Secret).first() is not None
            finally:
                db.close()
            if has_secrets:
                raise RuntimeError("vault.salt is missing. Restore the original salt file to unlock existing secrets.")
            self._ensure_salt()
        with open(self.salt_file, "rb") as f:
            salt = f.read()
        if len(salt) < 16:
            raise RuntimeError("vault.salt is invalid.")
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(), length=32, salt=salt, iterations=480000
        )
        key = base64.urlsafe_b64encode(kdf.derive(master_password.encode()))
        candidate = Fernet(key)
        verifier_present = os.path.exists(self.verifier_file)
        if verifier_present and self._verifier_matches(candidate):
            pass
        else:
            opens, has_blobs = self._password_opens_vault(candidate)
            can_bind = opens and (has_blobs or not verifier_present)
            if not can_bind:
                self._log_audit("UNSEAL", "VAULT", "DENIED_BAD_PASSWORD")
                raise PermissionError("Wrong master password")
            self._write_verifier(candidate)
        self.fernet = candidate
        self._log_audit("UNSEAL", "VAULT", "SUCCESS")

    def seal(self):
        self.fernet = None
        self._log_audit("SEAL", "VAULT", "SUCCESS")

    def create_token(self, name: str, policies: dict) -> str:
        token_id = f"mv.{uuid.uuid4().hex}"
        db = SessionLocal()
        token = Token(id=self.token_digest(token_id), name=name, policies=json.dumps(policies))
        db.add(token)
        db.commit()
        db.close()
        self._log_audit("CREATE_TOKEN", f"TOKEN:{name}", "SUCCESS", token_id="SYSTEM")
        return token_id

    def check_access(self, token_id: str, path: str, required_action: str):
        if self.is_sealed():
            raise RuntimeError("Vault is Sealed")
            
        root_token = os.environ.get("VAULT_ROOT_TOKEN", "root")
        if token_id == root_token:
            class RootVirtualToken:
                id = token_id
                policies = json.dumps({"*": "admin"})
            return RootVirtualToken()
            
        # 0. AppRole Lightweight Auth (Friction Zero for SDKs)
        static_app_token = os.environ.get("VAULT_APP_TOKEN")
        if static_app_token and token_id == static_app_token:
            class VirtualToken:
                id = token_id
                policies = json.dumps({"*": "read"})
            return VirtualToken()


        db = SessionLocal()
        token = db.query(Token).filter(Token.id == self.token_digest(token_id), Token.is_active == True).first()
        db.close()
        
        if not token:
            self._log_audit(required_action, path, "DENIED_INVALID_TOKEN", token_id=token_id)
            raise PermissionError("Invalid Token")

        policies = json.loads(token.policies)
        policy = policies.get(path, policies.get("*", ""))
        
        if policy != required_action and policy != "admin":
            self._log_audit(required_action, path, "DENIED_RBAC", token_id=token_id)
            raise PermissionError("Permission Denied")
            
        return token

    def write_secret(self, token_id: str, path: str, value: str):
        self.check_access(token_id, path, "write")
        db = SessionLocal()
        
        last_secret = db.query(Secret).filter(Secret.key_path == path).order_by(Secret.version.desc()).first()
        new_version = (last_secret.version + 1) if last_secret else 1
        
        encrypted_val = self.fernet.encrypt(value.encode()).decode('utf-8')
        
        secret = Secret(key_path=path, version=new_version, encrypted_value=encrypted_val)
        db.add(secret)
        db.commit()
        db.close()
        self._log_audit("WRITE_SECRET", f"{path}@v{new_version}", "SUCCESS", token_id=token_id)

    def delete_secret(self, token_id: str, path: str):
        self.check_access(token_id, path, "write")
        db = SessionLocal()
        deleted = db.query(Secret).filter(Secret.key_path == path).delete()
        db.commit()
        db.close()
        if not deleted:
            raise LookupError("Secret not found")
        self._log_audit("DELETE_SECRET", path, "SUCCESS", token_id=token_id)

    def revoke_token(self, actor_token: str, accessor: str):
        self.check_access(actor_token, "sys/tokens", "admin")
        db = SessionLocal()
        try:
            tokens = db.query(Token).all()
            for t in tokens:
                if self.accessor_from_stored(t.id) == accessor:
                    if not t.is_active:
                        return t.name
                    t.is_active = False
                    db.commit()
                    self._log_audit("REVOKE_TOKEN", t.name, "SUCCESS", token_id=actor_token)
                    return t.name
        finally:
            db.close()
        raise LookupError("Token not found")

    def _env_to_dict(self, text: str) -> dict:
        parsed = {}
        for line in (text or "").splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("export "):
                s = s[7:].strip()
            if "=" not in s:
                continue
            k, _, v = s.partition("=")
            k = k.strip()
            v = v.strip()
            if len(v) >= 2 and ((v[0] == v[-1] == '"') or (v[0] == v[-1] == "'")):
                v = v[1:-1]
            if k:
                parsed[k] = v
        return parsed

    def _as_dict(self, raw):
        if not raw:
            return {}
        if isinstance(raw, dict):
            return raw
        if not isinstance(raw, str):
            return {"value": raw}
        text = raw.strip()
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                if list(data.keys()) == ["value"] and isinstance(data.get("value"), str):
                    nested = self._env_to_dict(data["value"])
                    if nested:
                        return nested
                    try:
                        inner = json.loads(data["value"])
                        if isinstance(inner, dict) and inner:
                            return inner
                    except Exception:
                        pass
                return data
            if isinstance(data, str):
                return self._as_dict(data)
            return {"value": data}
        except Exception:
            env = self._env_to_dict(text)
            return env if env else {"value": raw}

    def resolve_layers(self, token_id: str, path: str):
        self.check_access(token_id, path, "read")
        shared = self._as_dict(self.get_raw_secret("global"))
        if path == "global":
            sources = {k: "shared" for k in shared}
            return {
                "path": "global",
                "shared": shared,
                "overrides": {},
                "merged": shared,
                "sources": sources,
            }
        overrides = self._as_dict(self.get_raw_secret(path))
        merged = {**shared, **overrides}
        sources = {k: ("app" if k in overrides else "shared") for k in merged}
        return {
            "path": path,
            "shared": shared,
            "overrides": overrides,
            "merged": merged,
            "sources": sources,
        }

    def get_raw_secret(self, path: str, version: int = None):
        db = SessionLocal()
        query = db.query(Secret).filter(Secret.key_path == path)
        if version:
            secret = query.filter(Secret.version == version).first()
        else:
            secret = query.order_by(Secret.version.desc()).first()
        db.close()
        if not secret:
            return None
        if self.fernet is None:
            raise RuntimeError("Vault is Sealed")
        try:
            token = (secret.encrypted_value or "").strip().encode()
            return self.fernet.decrypt(token).decode("utf-8")
        except InvalidToken:
            raise ValueError(
                "Could not decrypt this secret. Lock the vault and unlock with the original master password."
            )

    def read_secret(self, token_id: str, path: str, public_key_b64: str = None, version: int = None):
        token_obj = self.check_access(token_id, path, "read")
        
        # 1. HIERARCHY (Shared/global + app overrides). App keys win; other apps are untouched.
        final_dict = dict(self._as_dict(self.get_raw_secret("global")))
        if path != "global":
            path_val = self.get_raw_secret(path, version)
            if path_val:
                final_dict.update(self._as_dict(path_val))
            elif not final_dict:
                self._log_audit("READ_SECRET", path, "NOT_FOUND", token_id=token_id)
                raise Exception("Secret not found")
        elif not final_dict:
            self._log_audit("READ_SECRET", path, "NOT_FOUND", token_id=token_id)
            raise Exception("Secret not found")
        # Optional bait / labels. Off by default so GET is a clean JSON object
        # that any app can consume. Mutating payloads is not the standard.
        inject = os.environ.get("TITAN_INJECT_HONEYTOKEN", "").lower() in ("1", "true", "yes")
        bait_key = os.environ.get("TITAN_HONEYTOKEN_FIELD", "VAULT_EMERGENCY_RECOVERY_TOKEN")
        bait_val = os.environ.get("TITAN_HONEYTOKEN_VALUE", "")
        if inject and bait_val:
            final_dict[bait_key] = bait_val
        if os.environ.get("TITAN_INJECT_CLASSIFICATION", "").lower() in ("1", "true", "yes"):
            final_dict["__titan_classification__"] = {
                k: _classify_key(k, bait_key) for k in final_dict
            }

        final_str = json.dumps(final_dict)

        # 3. E2E ENCRYPTION. A supplied public key must encrypt or the read fails.
        # Falling through would return the secret in clear, which the wire contract forbids.
        encrypted_response = final_str
        is_encrypted = False
        if public_key_b64 and public_key_b64.strip():
            encrypted_response = self._hybrid_encrypt(final_str, public_key_b64.strip())
            is_encrypted = True
        
        # 4. BURN ON READ
        policies = json.loads(token_obj.policies)
        if policies.get("_one_time") == True:
            db_burn = SessionLocal()
            burn_token = db_burn.query(Token).filter(Token.id == token_obj.id).first()
            if burn_token:
                burn_token.is_active = False
                db_burn.commit()
            db_burn.close()
            self._log_audit("BURN_TOKEN", self.token_accessor(token_id), "SUCCESS", token_id="SYSTEM")

        self._log_audit("READ_SECRET", path, "SUCCESS", token_id=token_id)
        return {"value": encrypted_response, "is_encrypted": is_encrypted}

    def _hybrid_encrypt(self, plaintext: str, public_key_b64: str) -> str:
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives import serialization
        import cryptography.hazmat.primitives.ciphers as ciphers
        import cryptography.hazmat.primitives.ciphers.algorithms as algorithms
        import cryptography.hazmat.primitives.ciphers.modes as modes
        try:
            pub_bytes = base64.b64decode(public_key_b64)
            pub_key = serialization.load_pem_public_key(pub_bytes)
            aes_key = os.urandom(32)
            iv = os.urandom(16)
            cipher = ciphers.Cipher(algorithms.AES(aes_key), modes.CFB(iv))
            encryptor = cipher.encryptor()
            ciphertext_aes = encryptor.update(plaintext.encode()) + encryptor.finalize()
            enc_aes_key = pub_key.encrypt(
                aes_key,
                padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)
            )
            return base64.b64encode(enc_aes_key + iv + ciphertext_aes).decode("utf-8")
        except Exception as exc:
            raise ValueError("Could not encrypt the response with the supplied public key.") from exc

    # ==========================================
    # 5. TRANSIT ENGINE (CaaS - Cryptography as a Service)
    # ==========================================
    def _get_transit_key_bytes(self, name: str) -> tuple:
        if self.is_sealed():
            raise RuntimeError("Vault is Sealed")
        db = SessionLocal()
        try:
            tk = db.query(TransitKey).filter(TransitKey.name == name).first()
            if not tk:
                raise LookupError(f"Transit key '{name}' not found")
            raw_key = self.fernet.decrypt(tk.encrypted_key.encode('utf-8'))
            return raw_key, tk.key_type
        finally:
            db.close()

    def create_transit_key(self, token_id: str, name: str, key_type: str = "aes-gcm") -> dict:
        self.check_access(token_id, f"transit/{name}", "write")
        if key_type not in ["aes-gcm", "hmac-sha256"]:
            raise ValueError("Unsupported key_type. Must be 'aes-gcm' or 'hmac-sha256'")
        
        db = SessionLocal()
        try:
            existing = db.query(TransitKey).filter(TransitKey.name == name).first()
            if existing:
                return {
                    "name": existing.name,
                    "key_type": existing.key_type,
                    "created_at": existing.created_at.isoformat() if existing.created_at else None,
                    "status": "exists"
                }
            
            raw_key = os.urandom(32)
            enc_key = self.fernet.encrypt(raw_key).decode('utf-8')
            tk = TransitKey(name=name, key_type=key_type, encrypted_key=enc_key)
            db.add(tk)
            db.commit()
            self._log_audit("CREATE_TRANSIT_KEY", f"transit/{name}", "SUCCESS", token_id=token_id)
            return {
                "name": name,
                "key_type": key_type,
                "created_at": tk.created_at.isoformat() if tk.created_at else None,
                "status": "created"
            }
        finally:
            db.close()

    def encrypt_transit(self, token_id: str, name: str, plaintext: str) -> str:
        self.check_access(token_id, f"transit/{name}", "read")
        raw_key, key_type = self._get_transit_key_bytes(name)
        if key_type != "aes-gcm":
            raise ValueError(f"Transit key '{name}' is of type '{key_type}', expected 'aes-gcm'")
        
        aesgcm = AESGCM(raw_key)
        nonce = os.urandom(12)
        ct = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
        self._log_audit("TRANSIT_ENCRYPT", f"transit/{name}", "SUCCESS", token_id=token_id)
        return "vault:v1:" + base64.b64encode(nonce + ct).decode('utf-8')

    def decrypt_transit(self, token_id: str, name: str, ciphertext: str) -> str:
        self.check_access(token_id, f"transit/{name}", "read")
        raw_key, key_type = self._get_transit_key_bytes(name)
        if key_type != "aes-gcm":
            raise ValueError(f"Transit key '{name}' is of type '{key_type}', expected 'aes-gcm'")
        
        ct_clean = ciphertext.strip()
        if ct_clean.startswith("vault:v1:"):
            ct_clean = ct_clean[9:]
        raw_payload = base64.b64decode(ct_clean)
        if len(raw_payload) < 28:
            raise ValueError("Invalid ciphertext length")
        nonce = raw_payload[:12]
        ct = raw_payload[12:]
        aesgcm = AESGCM(raw_key)
        plaintext = aesgcm.decrypt(nonce, ct, None).decode('utf-8')
        self._log_audit("TRANSIT_DECRYPT", f"transit/{name}", "SUCCESS", token_id=token_id)
        return plaintext

    def sign_transit(self, token_id: str, name: str, data: str) -> str:
        self.check_access(token_id, f"transit/{name}", "read")
        raw_key, key_type = self._get_transit_key_bytes(name)
        h = hmac.HMAC(raw_key, hashes.SHA256())
        h.update(data.encode('utf-8'))
        sig = base64.b64encode(h.finalize()).decode('utf-8')
        self._log_audit("TRANSIT_SIGN", f"transit/{name}", "SUCCESS", token_id=token_id)
        return "vault:v1:" + sig

    def verify_transit(self, token_id: str, name: str, data: str, signature: str) -> bool:
        self.check_access(token_id, f"transit/{name}", "read")
        raw_key, key_type = self._get_transit_key_bytes(name)
        sig_clean = signature.strip()
        if sig_clean.startswith("vault:v1:"):
            sig_clean = sig_clean[9:]
        raw_sig = base64.b64decode(sig_clean)
        h = hmac.HMAC(raw_key, hashes.SHA256())
        h.update(data.encode('utf-8'))
        try:
            h.verify(raw_sig)
            self._log_audit("TRANSIT_VERIFY", f"transit/{name}", "SUCCESS", token_id=token_id)
            return True
        except Exception:
            self._log_audit("TRANSIT_VERIFY", f"transit/{name}", "FAILED_SIGNATURE", token_id=token_id)
            return False

    def list_transit_keys(self, token_id: str) -> list:
        self.check_access(token_id, "transit/*", "read")
        db = SessionLocal()
        try:
            keys = db.query(TransitKey).all()
            return [{
                "name": k.name,
                "key_type": k.key_type,
                "created_at": k.created_at.isoformat() if k.created_at else None
            } for k in keys]
        finally:
            db.close()

