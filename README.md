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

`data.value` is a JSON string. Parse the HTTP body, then parse `data.value`. Leave out `x-vault-public-key` and `is_encrypted` stays `false`.

## From your app

Send `GET /secret/data/{app}` with the header `x-vault-token`. The snippets below use the app name `encuesta-prod`.

### Node

Install the client in that project and load it before the rest of the app:

```bash
npm install titan-vault-node
```

```typescript
import { TitanVault } from "titan-vault-node";

await TitanVault.armParanoiaMode({
  vaultUrl: process.env.VAULT_URL || "http://127.0.0.1:8200",
  vaultToken: process.env.VAULT_APP_TOKEN,
  path: "encuesta-prod",
});

const databaseUrl = TitanVault.config.get("DATABASE_URL");
```

[`titan-vault-node`](https://www.npmjs.com/package/titan-vault-node) decrypts the payload when you send a public key. It keeps password fields for the database hooks and throws if the vault does not answer. The package README shows the rest, including `armParanoiaMode`.

### PHP

```php
$ch = curl_init("http://localhost:8200/secret/data/encuesta-prod");
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => ["x-vault-token: $token"],
    CURLOPT_RETURNTRANSFER => true,
]);
$body = json_decode(curl_exec($ch), true);
$secrets = json_decode($body["data"]["value"], true);
```

### Java

```java
HttpRequest req = HttpRequest.newBuilder()
    .uri(URI.create("http://localhost:8200/secret/data/encuesta-prod"))
    .header("x-vault-token", token)
    .build();
String body = HttpClient.newHttpClient()
    .send(req, HttpResponse.BodyHandlers.ofString())
    .body();
// Parse `body`, then parse the string in data.value with Jackson or Gson.
```

### Ruby

```ruby
require "json"
require "net/http"

uri = URI("http://localhost:8200/secret/data/encuesta-prod")
req = Net::HTTP::Get.new(uri)
req["x-vault-token"] = token
body = JSON.parse(Net::HTTP.start(uri.hostname, uri.port) { |h| h.request(req) }.body)
secrets = JSON.parse(body.dig("data", "value"))
```

### Go

```go
req, _ := http.NewRequest(http.MethodGet, "http://localhost:8200/secret/data/encuesta-prod", nil)
req.Header.Set("x-vault-token", token)
res, err := http.DefaultClient.Do(req)
if err != nil {
    return err
}
defer res.Body.Close()

var body struct {
    Data struct {
        Value string `json:"value"`
    } `json:"data"`
}
if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
    return err
}
var secrets map[string]string
if err := json.Unmarshal([]byte(body.Data.Value), &secrets); err != nil {
    return err
}
```

### Any other language

The vault speaks HTTP. There is no SDK requirement. Send `GET /secret/data/{your-app}` and the header `x-vault-token`. The response is JSON. `data.value` is a JSON object encoded as a string, so parse it a second time. That map is the merge: shared values plus this app's overrides.

Send `x-vault-public-key` only when you want the hybrid payload from [SPEC.md](SPEC.md). Then `is_encrypted` is `true`. The Node package decrypts that shape. The trap stays off unless `TITAN_INJECT_HONEYTOKEN` and `TITAN_HONEYTOKEN_VALUE` are set.

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
