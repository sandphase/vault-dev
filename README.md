# Titan Vault

Local secrets. One Docker. One merge.

Write a key **once** in Shared. Each app only stores what is **different**.  
`GET /secret/data/{app}` returns the merge. Nobody else is affected.

This is the contract. Anyone can reimplement it. Spec: [SPEC.md](SPEC.md). License: [MIT](LICENSE).

```bash
docker compose up --build
```

Open http://localhost:8200

1. Unlock with a **master password** and write it down. It encrypts secret values in `./vault-data`.
2. Sign in with `root` on a laptop, or set `VAULT_ROOT_TOKEN` to a random string.
3. **Apps** → Shared once → create an app → override only what must differ.
4. Give that app a token scoped to its name.

```bash
curl -sS -H "x-vault-token: $TOKEN" http://localhost:8200/secret/data/encuesta-prod
```

```json
{
  "path": "encuesta-prod",
  "data": {
    "value": "{\"DATABASE_URL\":\"postgres://prod\",\"REDIS_URL\":\"redis://shared\"}",
    "is_encrypted": false
  }
}
```

`data.value` is a JSON string; `JSON.parse` it. Send `x-vault-public-key` and the same field is the hybrid payload from [SPEC.md](SPEC.md). [`titan-vault-node`](https://www.npmjs.com/package/titan-vault-node) decrypts that payload. It reads `DATABASE_URL` with `TitanVault.config.get`, keeps password fields for the database hooks, and throws if the vault does not answer. The trap stays off unless `TITAN_INJECT_HONEYTOKEN` and `TITAN_HONEYTOKEN_VALUE` are set; the SDK then sends that value to `GET /sys/recovery`.

Not a SaaS. Not a cluster. Not HashiCorp. If you lose the master password, the secret values are gone. Paths and token policies in `vault.db` stay readable. See [SECURITY.md](SECURITY.md).

## Optional

| Env | Purpose |
|-----|---------|
| `VAULT_ROOT_TOKEN` | Admin token (set this off-laptop) |
| `VAULT_APP_TOKEN` | Read-only machine token for every app |
| `VAULT_CORS_ORIGINS` | Comma-separated origins (default `http://localhost:5173`) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerts if you enable the optional trap |

## Dev UI

```bash
uvicorn titan_vault.api:app --host 0.0.0.0 --port 8200
cd admin-ui && npm install && npm run dev
```

Open http://localhost:5173. Docker serves the UI on port 8200; this dev server does not.
