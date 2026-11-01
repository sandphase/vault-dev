"""Locks the promises in README.md and SPEC.md.

VAULT_DATA_DIR is set before titan_vault is imported because the database
engine is created at import time.
"""
import json
import os
import tempfile
import unittest

_TMP = tempfile.mkdtemp(prefix="titan-contract-")
os.environ["VAULT_DATA_DIR"] = _TMP
os.environ["VAULT_ROOT_TOKEN"] = "root-test"

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

from titan_vault.core import VaultCore
from titan_vault.database import AuditLog, SessionLocal, Token


def _rsa_public_b64() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    import base64
    return base64.b64encode(pem).decode("ascii")


class ContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vault = VaultCore.get_instance()
        cls.root = "root-test"

    def test_contract(self):
        self._password_binds_before_any_secret()
        self._merge_app_wins_and_other_apps_stay_put()
        self._scoped_token_and_storage()
        self._legacy_plaintext_token_is_hashed()
        self._bad_public_key_does_not_return_plaintext()
        self._wrong_password_rejected_once_secrets_exist()

    def _password_binds_before_any_secret(self):
        self.vault.unseal("correct-horse")
        self.vault.seal()
        with self.assertRaises(PermissionError):
            self.vault.unseal("another-password")
        self.vault.unseal("correct-horse")

    def _merge_app_wins_and_other_apps_stay_put(self):
        self.vault.write_secret(self.root, "global", json.dumps({
            "DATABASE_URL": "postgres://shared",
            "REDIS_URL": "redis://shared",
            "FEATURE_FLAG": "on",
        }))
        self.vault.write_secret(self.root, "encuesta-prod", json.dumps({
            "DATABASE_URL": "postgres://prod",
        }))
        self.vault.write_secret(self.root, "encuesta-staging", json.dumps({
            "FEATURE_FLAG": "off",
        }))
        self.vault.write_secret(self.root, "global", json.dumps({
            "DATABASE_URL": "postgres://shared2",
            "REDIS_URL": "redis://shared",
            "FEATURE_FLAG": "on",
            "NEW": "x",
        }))
        prod = json.loads(self.vault.read_secret(self.root, "encuesta-prod")["value"])
        staging = json.loads(self.vault.read_secret(self.root, "encuesta-staging")["value"])
        self.assertEqual(prod["DATABASE_URL"], "postgres://prod")
        self.assertEqual(prod["NEW"], "x")
        self.assertEqual(staging["DATABASE_URL"], "postgres://shared2")
        self.assertEqual(staging["FEATURE_FLAG"], "off")
        resolved = self.vault.resolve_layers(self.root, "encuesta-prod")
        self.assertEqual(resolved["overrides"], {"DATABASE_URL": "postgres://prod"})
        self.assertNotIn("NEW", resolved["overrides"])

    def _scoped_token_and_storage(self):
        raw = self.vault.create_token("encuesta-prod", {"encuesta-prod": "read"})
        db = SessionLocal()
        try:
            row = db.query(Token).filter(Token.name == "encuesta-prod").one()
            stored = row.id
            audit_blob = " ".join(
                f"{log.token_id} {log.resource}" for log in db.query(AuditLog).all()
            )
        finally:
            db.close()
        self.assertNotEqual(stored, raw)
        self.assertEqual(stored, VaultCore.token_digest(raw))
        self.assertNotIn(raw, audit_blob)
        self.assertNotIn(raw, stored)
        merged = json.loads(self.vault.read_secret(raw, "encuesta-prod")["value"])
        self.assertEqual(merged["DATABASE_URL"], "postgres://prod")
        with self.assertRaises(PermissionError):
            self.vault.read_secret(raw, "encuesta-staging")
        db = SessionLocal()
        try:
            actors = [log.token_id for log in db.query(AuditLog).filter(AuditLog.action == "READ_SECRET").all()]
        finally:
            db.close()
        self.assertIn(VaultCore.token_accessor(raw), actors)
        self.assertNotIn(raw, actors)

    def _legacy_plaintext_token_is_hashed(self):
        legacy = "mv.legacyplaintexttoken"
        db = SessionLocal()
        try:
            db.add(Token(id=legacy, name="legacy", policies=json.dumps({"encuesta-prod": "read"})))
            db.execute(
                text("INSERT INTO audit_logs (token_id, action, resource, status) VALUES (:t, 'READ_SECRET', :t, 'SUCCESS')"),
                {"t": legacy},
            )
            db.commit()
        finally:
            db.close()
        self.vault._migrate_plaintext_tokens()
        merged = json.loads(self.vault.read_secret(legacy, "encuesta-prod")["value"])
        self.assertEqual(merged["REDIS_URL"], "redis://shared")
        db = SessionLocal()
        try:
            ids = [row[0] for row in db.execute(text("SELECT id FROM tokens")).fetchall()]
            actors = [row[0] for row in db.execute(text("SELECT token_id FROM audit_logs")).fetchall()]
            resources = [row[0] for row in db.execute(text("SELECT resource FROM audit_logs")).fetchall()]
        finally:
            db.close()
        self.assertNotIn(legacy, ids)
        self.assertNotIn(legacy, actors)
        self.assertNotIn(legacy, resources)
        self.assertIn(VaultCore.token_digest(legacy), ids)

    def _bad_public_key_does_not_return_plaintext(self):
        with self.assertRaises(ValueError) as caught:
            self.vault.read_secret(self.root, "encuesta-prod", public_key_b64="bm90LWEta2V5")
        self.assertNotIn("postgres://prod", str(caught.exception))
        encrypted = self.vault.read_secret(self.root, "encuesta-prod", public_key_b64=_rsa_public_b64())
        self.assertTrue(encrypted["is_encrypted"])
        self.assertNotIn("postgres://prod", encrypted["value"])

    def _wrong_password_rejected_once_secrets_exist(self):
        self.vault.seal()
        with self.assertRaises(PermissionError):
            self.vault.unseal("stolen-password")
        self.vault.unseal("correct-horse")


if __name__ == "__main__":
    unittest.main()
