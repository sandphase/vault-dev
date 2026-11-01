# Titan merge spec (v0)

A vault anyone can reimplement. No SaaS. No cluster. One HTTP contract.

## Model

Two layers, one name:

1. **Shared** — path `global`. Written once. Every app inherits it.
2. **App** — path `{app}`. Stores **only keys that differ** (and app-only keys).

Read merge: `result = shared ∪ app`, **app wins** on name collision. Other apps are not touched.

That is the whole standard. Environments are just app names (`encuesta-prod`, `encuesta-staging`).

## Wire

Base URL is the vault (default `http://localhost:8200`).

Auth: header `x-vault-token: <token>`.

| Method | Path | Meaning |
|--------|------|---------|
| GET | `/secret/data/{app}` | Merged object for that app |
| POST | `/secret/data/{app}` | Replace that layer (`global` or app). Body: `{"value": "<json object>"}` |
| GET | `/secret/resolved/{app}` | Same merge plus `shared`, `overrides`, `sources` (admin/debug) |

Successful read:

```json
{
  "path": "encuesta-prod",
  "data": {
    "value": "{\"DATABASE_URL\":\"postgres://shared\",\"FEATURE_FLAG\":\"on\"}",
    "is_encrypted": false
  }
}
```

`data.value` is a JSON string of a flat object with string keys; parse it once. No bait fields by default.
If the client sent `x-vault-public-key`, `data.is_encrypted` is `true` and `data.value` is the base64 hybrid payload (RSA-OAEP-SHA256 key wrap + AES-256-CFB). This is the shape `titan-vault-node` 2.x reads; it must not change within v0.

Example:

```bash
curl -sS -H "x-vault-token: $TOKEN" http://localhost:8200/secret/data/encuesta-prod
```

## Compatibility

Another server is Titan-compatible if:

- `GET /secret/data/{app}` returns the merge above
- writing `global` does not require rewriting each app
- overriding one key on one app does not change other apps

Transit, audit, honeytokens, and the admin UI are **not** part of this spec.

## Status

Draft, 2026. MIT. Intended to stay small enough to implement in a weekend.
