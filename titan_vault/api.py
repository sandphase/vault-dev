from fastapi import FastAPI, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
import os
import json
from typing import Optional, Dict
from titan_vault.core import VaultCore

app = FastAPI(title="Titan Vault API")

_cors = [o.strip() for o in os.environ.get("VAULT_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vault = VaultCore.get_instance()

ALLOWED_PERMS = {"read", "write", "admin"}
HONEYTOKEN_FIELD = "VAULT_EMERGENCY_RECOVERY_TOKEN"


def http_from_vault_error(e: Exception) -> HTTPException:
    msg = str(e) or e.__class__.__name__
    if isinstance(e, PermissionError) or msg == "Invalid Token":
        if "Invalid Token" in msg or "Wrong master password" in msg:
            return HTTPException(status_code=401, detail=msg)
        return HTTPException(status_code=403, detail=msg)
    if isinstance(e, RuntimeError) or "Sealed" in msg:
        return HTTPException(status_code=503, detail=msg)
    if isinstance(e, LookupError) or "not found" in msg.lower():
        return HTTPException(status_code=404, detail=msg)
    return HTTPException(status_code=400, detail=msg)


class UnsealRequest(BaseModel):
    master_password: str


class TokenRequest(BaseModel):
    name: str
    policies: Dict[str, str]

    @field_validator("name")
    @classmethod
    def name_ok(cls, v: str) -> str:
        v = (v or "").strip()
        if not v or len(v) > 80:
            raise ValueError("Name must be 1–80 characters")
        return v

    @field_validator("policies")
    @classmethod
    def policies_ok(cls, v: Dict[str, str]) -> Dict[str, str]:
        if not v:
            raise ValueError("At least one policy is required")
        cleaned = {}
        for path, perm in v.items():
            p = (path or "").strip()
            if not p:
                raise ValueError("Policy path cannot be empty")
            if perm not in ALLOWED_PERMS:
                raise ValueError(f"Invalid permission: {perm}")
            cleaned[p] = perm
        if not cleaned:
            raise ValueError("At least one policy is required")
        return cleaned


class SecretWriteRequest(BaseModel):
    value: str


class RevokeRequest(BaseModel):
    accessor: str = Field(min_length=8, max_length=64)


class TransitKeyCreateRequest(BaseModel):
    key_type: Optional[str] = "aes-gcm"


class TransitEncryptRequest(BaseModel):
    plaintext: str


class TransitDecryptRequest(BaseModel):
    ciphertext: str


class TransitSignRequest(BaseModel):
    data: str


class TransitVerifyRequest(BaseModel):
    data: str
    signature: str


def get_token(x_vault_token: str = Header(..., description="Vault Bearer Token")):

    return x_vault_token


@app.get("/sys/health")
def health_check():
    return {
        "sealed": vault.is_sealed(),
        "has_data": vault.has_existing_data(),
    }


@app.post("/sys/unseal")
def unseal_vault(req: UnsealRequest):
    try:
        vault.unseal(req.master_password)
        return {"status": "unsealed"}
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/sys/seal")
def seal_vault(token: str = Depends(get_token)):
    if vault.is_sealed():
        return {"status": "sealed"}
    try:
        vault.check_access(token, "sys/tokens", "admin")
        vault.seal()
        return {"status": "sealed"}
    except Exception as e:
        raise http_from_vault_error(e)


@app.get("/sys/settings")
def get_settings(token: str = Depends(get_token)):
    try:
        vault.check_access(token, "sys/tokens", "admin")
        return {
            "telegram_bot_configured": bool(os.environ.get("TELEGRAM_BOT_TOKEN")),
            "telegram_chat_configured": bool(os.environ.get("TELEGRAM_CHAT_ID")),
            "honeytoken_field": os.environ.get("TITAN_HONEYTOKEN_FIELD", HONEYTOKEN_FIELD),
            "honeytoken_injected": os.environ.get("TITAN_INJECT_HONEYTOKEN", "").lower() in ("1", "true", "yes")
            and bool(os.environ.get("TITAN_HONEYTOKEN_VALUE")),
        }
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/auth/token/create")
def create_token(req: TokenRequest, token: str = Depends(get_token)):
    try:
        vault.check_access(token, "sys/tokens", "admin")
        new_token = vault.create_token(req.name, req.policies)
        return {
            "token": new_token,
            "name": req.name,
            "accessor": VaultCore.token_accessor(new_token),
        }
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/auth/token/revoke")
def revoke_token(req: RevokeRequest, token: str = Depends(get_token)):
    try:
        name = vault.revoke_token(token, req.accessor.strip())
        return {"status": "revoked", "name": name}
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/secret/data/{path:path}")
def write_secret(path: str, req: SecretWriteRequest, token: str = Depends(get_token)):
    try:
        vault.write_secret(token, path, req.value)
        return {"status": "success", "path": path}
    except Exception as e:
        raise http_from_vault_error(e)


@app.delete("/secret/data/{path:path}")
def delete_secret(path: str, token: str = Depends(get_token)):
    try:
        vault.delete_secret(token, path)
        return {"status": "deleted", "path": path}
    except Exception as e:
        raise http_from_vault_error(e)


def get_public_key(x_vault_public_key: Optional[str] = Header(None, description="Base64 encoded PEM RSA Public Key")):
    return x_vault_public_key


@app.get("/secret/resolved/{path:path}")
def resolve_secret(path: str, token: str = Depends(get_token)):
    try:
        return vault.resolve_layers(token, path)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise http_from_vault_error(e)


@app.get("/secret/data/{path:path}")
def read_secret(path: str, version: Optional[int] = None, token: str = Depends(get_token), public_key: str = Depends(get_public_key)):
    try:
        # Wire shape is frozen: titan-vault-node 2.x parses data.value / data.is_encrypted.
        response_data = vault.read_secret(token, path, public_key, version)
        return {"path": path, "data": response_data}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise http_from_vault_error(e)


@app.get("/sys/recovery")
def honeytoken_tripwire(request: Request, token: str = Depends(get_token)):
    bait = os.environ.get("TITAN_HONEYTOKEN_VALUE", "")
    if bait and token == bait:
        print("\n\n🚨 [ALERTA] HONEYTOKEN DETONADO. SELLANDO BÓVEDA INMEDIATAMENTE. 🚨\n\n")
        vault.seal()

        import requests
        bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
        chat_id = os.environ.get("TELEGRAM_CHAT_ID")

        if bot_token and chat_id:
            try:
                ip = request.client.host if request.client else "Desconocida"
                msg = f"🚨 *ALERTA ROJA - TITAN VAULT* 🚨\n\nHoneytoken detonado.\nBóveda sellada automáticamente.\nIP del atacante: `{ip}`"
                requests.post(
                    f"https://api.telegram.org/bot{bot_token}/sendMessage",
                    json={"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"},
                    timeout=5
                )
            except Exception as e:
                print(f"Error enviando alerta de Telegram: {e}")

        raise HTTPException(status_code=403, detail="Intrusion detected. Vault sealed.")
    raise HTTPException(status_code=403, detail="Invalid token")


def _public_actor(token_id: str) -> str:
    if not token_id or token_id == "SYSTEM":
        return token_id or "SYSTEM"
    if VaultCore._is_hex(token_id, 20):
        return token_id
    return VaultCore.token_accessor(token_id)


def _public_resource(resource: str) -> str:
    if resource and resource.startswith("mv."):
        return VaultCore.token_accessor(resource)
    return resource


@app.get("/sys/audit")
def get_audit_logs(token: str = Depends(get_token)):
    try:
        vault.check_access(token, "sys/audit", "admin")
        from titan_vault.database import SessionLocal, AuditLog
        db = SessionLocal()
        logs = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(100).all()
        res = [{
            "id": l.id,
            "timestamp": l.timestamp,
            "token_id": _public_actor(l.token_id),
            "action": l.action,
            "resource": _public_resource(l.resource),
            "status": l.status,
        } for l in logs]
        db.close()
        return res
    except Exception as e:
        raise http_from_vault_error(e)


@app.get("/sys/tokens")
def get_tokens(token: str = Depends(get_token)):
    try:
        vault.check_access(token, "sys/tokens", "admin")
        from titan_vault.database import SessionLocal, Token
        db = SessionLocal()
        tokens = db.query(Token).order_by(Token.created_at.desc()).all()
        res = []
        for t in tokens:
            try:
                policies = json.loads(t.policies) if isinstance(t.policies, str) else t.policies
            except Exception:
                policies = {}
            res.append({
                "accessor": VaultCore.accessor_from_stored(t.id),
                "name": t.name,
                "policies": policies,
                "created_at": t.created_at,
                "is_active": t.is_active,
            })
        db.close()
        return res
    except Exception as e:
        raise http_from_vault_error(e)


@app.get("/secret/metadata")
def get_secrets_metadata(token: str = Depends(get_token)):
    try:
        vault.check_access(token, "secret/metadata", "admin")
        from titan_vault.database import SessionLocal, Secret
        from sqlalchemy import func
        db = SessionLocal()
        secrets = db.query(Secret.key_path, func.max(Secret.version).label("version")).group_by(Secret.key_path).all()
        res = [{"path": s[0], "version": s[1]} for s in secrets]
        db.close()
        return res
    except Exception as e:
        raise http_from_vault_error(e)


# ==========================================
# TRANSIT ENGINE (CaaS) ENDPOINTS
# ==========================================
@app.get("/transit/keys")
def list_transit_keys(token: str = Depends(get_token)):
    try:
        return vault.list_transit_keys(token)
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/transit/keys/{name}")
def create_transit_key(name: str, req: Optional[TransitKeyCreateRequest] = None, token: str = Depends(get_token)):
    try:
        kt = req.key_type if req and req.key_type else "aes-gcm"
        return vault.create_transit_key(token, name, kt)
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/transit/encrypt/{name}")
def transit_encrypt(name: str, req: TransitEncryptRequest, token: str = Depends(get_token)):
    try:
        ciphertext = vault.encrypt_transit(token, name, req.plaintext)
        return {"ciphertext": ciphertext, "name": name}
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/transit/decrypt/{name}")
def transit_decrypt(name: str, req: TransitDecryptRequest, token: str = Depends(get_token)):
    try:
        plaintext = vault.decrypt_transit(token, name, req.ciphertext)
        return {"plaintext": plaintext, "name": name}
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/transit/sign/{name}")
def transit_sign(name: str, req: TransitSignRequest, token: str = Depends(get_token)):
    try:
        signature = vault.sign_transit(token, name, req.data)
        return {"signature": signature, "name": name}
    except Exception as e:
        raise http_from_vault_error(e)


@app.post("/transit/verify/{name}")
def transit_verify(name: str, req: TransitVerifyRequest, token: str = Depends(get_token)):
    try:
        valid = vault.verify_transit(token, name, req.data, req.signature)
        return {"valid": valid, "name": name}
    except Exception as e:
        raise http_from_vault_error(e)


if os.path.exists("admin-ui/dist"):

    app.mount("/assets", StaticFiles(directory="admin-ui/dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        file_path = os.path.join("admin-ui/dist", full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse("admin-ui/dist/index.html")
