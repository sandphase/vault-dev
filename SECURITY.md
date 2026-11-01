# Security

This is a **local** secrets box. It is not a clustered enterprise vault.

## Defaults that matter

- Set `VAULT_ROOT_TOKEN` to a long random value anywhere that is not a personal laptop. The bootstrap `root` token exists for first run only.
- Do not commit `vault.db`, `vault.salt`, or `./vault-data`.
- `GET /secret/data/{app}` returns a clean JSON object. Optional bait injection is **off** unless you set `TITAN_INJECT_HONEYTOKEN=1` and `TITAN_HONEYTOKEN_VALUE`. `titan-vault-node` calls `GET /sys/recovery` with that value when the trap field is read from `process.env`. The vault seals only when the header matches.
- CORS defaults to `http://localhost:5173`. Override with `VAULT_CORS_ORIGINS` (comma-separated). Docker UI is same-origin on `:8200`.

## If you lose the master password

Ciphertext in `./vault-data` cannot be recovered. That is by design.

## Report

Open a GitHub issue with **security** in the title, or contact the maintainer privately. Do not file a public PoC against other people's deployments.
