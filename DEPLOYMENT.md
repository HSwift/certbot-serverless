# Deploy Certbot Serverless to Cloudflare

This guide explains how to run the project in production using Cloudflare-managed Git deployments. Cloudflare builds two Workers from the same GitHub repository, so GitHub Actions is not required:

- `certbot-serverless-api`: API, D1, R2, Workflows, Cron Trigger, and certificate issuance.
- `certbot-serverless-console`: React static assets and a Service Binding that forwards `/api/*` to the API Worker.

Cloudflare Access protects the entire Console Worker. The API Worker remains routable, but `/api/*` requires a valid Access JWT or Bearer token, while `/download/*` requires a short-lived, single-use signature.

## Deployment architecture

```mermaid
flowchart LR
  Browser[Browser] --> Access[Cloudflare Access]
  Access --> Console[Console Worker + Static Assets]
  Console -->|Service Binding + signed Access JWT| API[API Worker]

  Client[Automation client] -->|Authorization: Bearer| API
  Download[One-time download URL] -->|signature + expiry + nonce| API
  Origin[systemd file sync] -->|Scoped Deployment URL| API

  API --> D1[(D1)]
  API --> R2[(R2)]
  API --> Workflow[Workflows]
  Cron[Cron Trigger] --> API
```

A Service Binding does not traverse a public URL. The Console Worker forwards the original `Request`, and the API Worker validates the `Cf-Access-Jwt-Assertion` again. This is necessary because the Access identity in `ctx.access` does not propagate across a Service Binding.

## Short path when the API Build is already complete

If `certbot-serverless-api` has deployed successfully and all five Runtime Secrets are present, complete these steps:

1. Create a `certbot-serverless-console` Build from the same GitHub repository.
2. Assign production domains to the API and Console Workers.
3. On the Console Worker's **Access** page, select **Protect this Worker behind Access**.
4. Restrict its Allow policy to your exact email address or identity-provider account.
5. Copy the Team Domain and AUD from the generated Access application.
6. Update `DOWNLOAD_URL_BASE`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` in the API Build.
7. Redeploy the API Worker and run the production validation steps.

See [Deploy the Console Worker](#deploy-the-console-worker) for its exact build settings.

## Prerequisites

- The project has been pushed to GitHub.
- The Cloudflare account has Workers, D1, R2, and Zero Trust enabled.
- The DNS zones used for issuance are in the same Cloudflare account, or the runtime API token has access to them.
- Local commands require Node.js 22, pnpm 11, OpenSSL, and the project-pinned Wrangler version.
- Two domains are recommended:
  - `console.example.com`: browser console protected by Access.
  - `cert-api.example.com`: automation API and presigned downloads, not placed behind Access.

You can initially deploy to `workers.dev` and add custom domains afterward.

Install dependencies and confirm that Wrangler is authenticated:

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler whoami
```

If Wrangler is not authorized yet:

```bash
pnpm exec wrangler login
```

Run the repository checks before deployment:

```bash
pnpm check
```

## Understand the four configuration categories

Do not confuse these four types of values:

| Type | Location | Sensitive | Purpose |
| --- | --- | --- | --- |
| Build Token | Workers Builds | Yes | Allows the Cloudflare build container to deploy Workers |
| Build Variables | **Settings → Builds → Variables and secrets** | No | Render the production Wrangler configuration during a build |
| Bootstrap Build Secrets | Same location, present only for the initial deployment | Yes | Create Runtime Secrets during the first deployment |
| Runtime Secrets | **Settings → Variables and Secrets** | Yes | Read by the Worker at runtime |

Cloudflare generates a Build Token for Workers Builds by default. Use that token unless the build log explicitly reports missing permissions. Only then select a custom token under **Settings → Builds → API token**.

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are identifiers, not secrets, so they can be regular Build Variables. API tokens, Bearer tokens, signing keys, encryption keys, and private keys must be stored as secrets.

## Create the runtime Cloudflare API token

Create a token under **My Profile → API Tokens** in Cloudflare. The application requires:

- **Zone → Zone → Read** to find a zone from a certificate hostname.
- **Zone → DNS → Edit** to create and remove ACME DNS-01 TXT records.
- **Zone → SSL and Certificates → Edit** to create and revoke Origin CA certificates.

Restrict Zone Resources to the zones for which the application will issue certificates. Do not use the Global API Key, and never commit the token to Git.

This token becomes the Worker's runtime `CLOUDFLARE_API_TOKEN`. It is separate from the Workers Builds deployment token.

## Generate the remaining Runtime Secrets

Generate three random values in a trusted local terminal:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

Save them, in order, as:

1. `API_BEARER_TOKEN`
2. `DOWNLOAD_SIGNING_KEY`
3. `CERTIFICATE_MASTER_KEY`

Generate the ACME account private key:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out acme-account.pem
```

The value of `ACME_ACCOUNT_KEY` is the complete content of `acme-account.pem`, including:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

Store all five Runtime Secrets in a password manager. If `CERTIFICATE_MASTER_KEY` is lost, encrypted certificate private keys already stored in R2 cannot be recovered. Changing `ACME_ACCOUNT_KEY` creates a new ACME account identity.

## Create D1 and R2

Create the resources using an authenticated local Wrangler session:

```bash
pnpm exec wrangler d1 create certbot-serverless --location apac
pnpm exec wrangler r2 bucket create certbot-serverless-certificates --location apac
```

Save the Database ID returned by D1. Do not use `--update-config`: `apps/api/wrangler.jsonc` intentionally retains generic placeholders, and the production Database ID is injected as a Build Variable.

If the resources already exist, find the D1 ID with:

```bash
pnpm exec wrangler d1 list
```

## Deploy the API Worker

### Create the Git Build

In the Cloudflare dashboard, open:

**Workers & Pages → Create application → Import a repository**

Select the GitHub repository and enter:

| Setting | Value |
| --- | --- |
| Worker name | `certbot-serverless-api` |
| Production branch | `main` |
| Root directory | Leave blank to use the repository root |
| Build command | `pnpm cf:render && pnpm --filter @certbot/api typecheck` |
| Deploy command | `pnpm cf:deploy` |

The Worker name must exactly match the `name` in `apps/api/wrangler.jsonc`.

Disable non-production branch builds for now. Preview branches must not share production D1, R2, secrets, or Access configuration.

### Set API Build Variables

Under **Settings → Builds → Variables and secrets**, add these regular variables:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `11.26.0` |
| `D1_DATABASE_ID` | The D1 Database ID saved earlier |
| `DOWNLOAD_URL_BASE` | The public HTTPS address of the API |
| `ACCESS_TEAM_DOMAIN` | The complete Access Team Domain |
| `ACCESS_AUD` | The Console Access application's Audience Tag |

The API domain and Access application may not exist during the initial deployment. Temporary values are acceptable for bootstrap:

```text
DOWNLOAD_URL_BASE=https://api.invalid
ACCESS_TEAM_DOMAIN=https://placeholder.cloudflareaccess.com
ACCESS_AUD=replace-with-access-application-aud
```

These placeholders are only for completing the first deployment. At that stage, the health check works, but Console Access authentication and generated download links do not.

### Bootstrap secrets for the first deployment

If the API Worker does not have Runtime Secrets yet, add these values as **Secret** entries on the same Build configuration page:

| Bootstrap Build Secret | Runtime Secret created |
| --- | --- |
| `RUNTIME_CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_API_TOKEN` |
| `RUNTIME_API_BEARER_TOKEN` | `API_BEARER_TOKEN` |
| `RUNTIME_DOWNLOAD_SIGNING_KEY` | `DOWNLOAD_SIGNING_KEY` |
| `RUNTIME_CERTIFICATE_MASTER_KEY` | `CERTIFICATE_MASTER_KEY` |
| `RUNTIME_ACME_ACCOUNT_KEY` | `ACME_ACCOUNT_KEY` |

All five values must be supplied together. The build scripts will:

1. Generate a temporary `apps/api/wrangler.generated.jsonc`.
2. Apply migrations to the remote D1 database.
3. Write the bootstrap values as Worker Runtime Secrets.
4. Deploy the API Worker, Workflow, and Cron Trigger.
5. Delete temporary configuration and secret files from the build container.

If the Worker already has all five Runtime Secrets, do not add the `RUNTIME_*` values again. A normal deployment preserves existing Runtime Secrets.

Save the configuration and run the first Build. A successful log should show the D1 migrations and completed `wrangler deploy` operation.

### Remove the one-time Bootstrap Secrets

After the first successful deployment, remove every `RUNTIME_*` Build Secret from **Settings → Builds → Variables and secrets**. Run the Build once more to confirm that the existing Runtime Secrets are preserved.

Do not remove the five Worker Runtime Secrets without the `RUNTIME_` prefix from **Settings → Variables and Secrets**.

For later Runtime Secret rotation, update the value under the Worker's **Settings → Variables and Secrets**. You can also use an interactive Wrangler command, for example:

```bash
pnpm exec wrangler secret put API_BEARER_TOKEN --name certbot-serverless-api
```

Never place a secret in a command argument, `wrangler.jsonc`, or a Git-tracked file.

## Configure the API domain

Open **Settings → Domains & Routes** for the API Worker and add a domain such as:

```text
cert-api.example.com
```

Then update the API Build Variable to the real address:

```text
DOWNLOAD_URL_BASE=https://cert-api.example.com
```

Redeploy the API Worker. Newly generated presigned download URLs will use this address.

Do not enable Worker-level Access for the API Worker or create a browser-login Access application covering the entire API domain. Either would block Bearer clients and presigned downloads before their requests reach the Worker. The API Worker still enforces:

- `/api/*`: Access JWT or `Authorization: Bearer`.
- `/download/*`: HMAC signature, expiry, and single-use nonce.
- `/deploy/*`: a revocable, certificate-scoped Deployment Token embedded in a generated systemd service.
- `/api/health`: public health check with no sensitive information.

If the account has **Protect all Workers** enabled, make this Worker public or bypass account-level Access on its **Access** page. Public here only means that requests can reach the Worker; application authentication still protects its business endpoints.

## Deploy the Console Worker

After the API Worker exists successfully, create another Worker Build from the same GitHub repository:

| Setting | Value |
| --- | --- |
| Worker name | `certbot-serverless-console` |
| Production branch | `main` |
| Root directory | `apps/web` |
| Build command | `pnpm build` |
| Deploy command | `pnpm exec wrangler deploy` |

Add two regular Build Variables:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `PNPM_VERSION` | `11.26.0` |

The Console Worker requires no D1, R2, or Runtime Secrets. `apps/web/wrangler.jsonc` already declares:

- `./dist` as the Static Assets directory.
- SPA fallback.
- Worker-first handling for `/api` and `/api/*`.
- An `API` Service Binding targeting `certbot-serverless-api`.

The Cloudflare build form does not need a Build output directory. `wrangler deploy` reads `assets.directory` and uploads `./dist`. The target API Worker must already exist or the Service Binding deployment will fail.

## Configure the Console domain and Zero Trust

### Add a domain

Under **Settings → Domains & Routes** for the Console Worker, add a domain such as:

```text
console.example.com
```

### Protect the entire Console Worker

Open:

**Workers & Pages → certbot-serverless-console → Access**

Select **Protect this Worker behind Access** and protect **All traffic**. Worker-level Access covers the Worker's production `workers.dev` address, custom domains, Routes, and Preview URLs, which helps avoid leaving an alternate entry point unprotected.

For a single-user deployment, configure the Access application's Allow policy as:

```text
Action: Allow
Include: Emails
Value: your-email@example.com
```

Do not use `Include Everyone` or any-valid-email rules. If the Access setup wizard initially offers only a broader account policy, finish creating the application, then open **Zero Trust → Access controls → Applications** and narrow the policy to the exact email address. Verify that the narrower policy works before deleting a temporary broad policy.

### Get the Team Domain and AUD

Find the Team Domain under:

**Zero Trust → Settings → Team name and domain**

Use the complete URL:

```text
https://your-team.cloudflareaccess.com
```

Find the AUD under:

**Zero Trust → Access controls → Applications → Console Application → Configure → Additional settings**

Copy the **Application Audience (AUD) Tag**. It is not the Application ID or Policy ID.

Return to **Settings → Builds → Variables and secrets** for `certbot-serverless-api` and update:

```text
ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
ACCESS_AUD=<console-application-aud>
```

Both values are regular Build Variables, not secrets. Redeploy the API Worker so it can validate the Access JWT forwarded by the Console Worker through the Service Binding.

## Production validation

Replace the example domains below with the real addresses.

### 1. API health check

```bash
curl https://cert-api.example.com/api/health
```

The response should contain `status: ok`.

### 2. Unauthenticated API requests must be rejected

```bash
curl -i https://cert-api.example.com/api/me
```

The response should be `401`.

### 3. Bearer API authentication

```bash
curl https://cert-api.example.com/api/me \
  -H "Authorization: Bearer <API_BEARER_TOKEN>"
```

The response should contain:

```json
{
  "actor": {
    "id": "api-token",
    "method": "bearer"
  }
}
```

### 4. Console Access authentication

1. Open the Console domain in a private browsing window. The Access login page should appear first.
2. Sign in with the allowed email address.
3. In the same browser, open `https://console.example.com/api/me`.
4. The response should contain `method: access`, and `id` should be the signed-in email address.

If the Console loads but `/api/*` returns `401`, check:

- Whether the API Build was redeployed with the real `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
- Whether the AUD came from the Access application protecting the Console Worker.
- Whether the Console Worker targets the exact service name `certbot-serverless-api`.

### 5. Issuance and download

Create a test certificate from the Console and confirm:

- The Workflow progresses from queued or running to succeeded.
- Temporary Let's Encrypt DNS-01 TXT records are removed afterward.
- An encrypted object appears in R2.
- The generated download link uses the API domain.
- The download URL cannot be reused after its first successful request.
- The downloaded ZIP contains `cert.pem`, `chain.pem`, `fullchain.pem`, `privkey.pem`, `request.csr`, and `metadata.json`.

### 6. systemd file synchronization

From the active certificate's action menu, choose **Generate sync units** and enter:

- A lowercase unit identifier.
- An absolute destination directory.
- A synchronization interval.

Download the generated `.service` and `.timer` files, then run the installation commands shown in the Console. The target host needs `systemd`, `curl`, `unzip`, and GNU `install`.

The service contains the long-lived Deployment URL, so install it with mode `0600`. It downloads the current certificate version on every run and updates `cert.pem`, `chain.pem`, `fullchain.pem`, `privkey.pem`, `request.csr`, and `metadata.json` in the selected directory. It deliberately does not reload or restart any application.

Run the service once manually and confirm the files appear:

```bash
sudo systemctl start certbot-sync-<name>.service
sudo systemctl status certbot-sync-<name>.service
sudo systemctl list-timers 'certbot-sync-*'
```

Return to the Console to confirm that **Last sync** is populated. Revoking the Deployment URL must cause later service runs to fail with an HTTP error without replacing the existing local files.

## Routine deployments

After initialization, only push `main`:

```bash
git push origin main
```

Cloudflare triggers the API and Console Builds separately. The repository requires neither GitHub Actions nor committed generated Wrangler configuration or secrets.

A normal API Build no longer includes `RUNTIME_*` and follows this sequence:

1. `pnpm cf:render` generates temporary configuration from Build Variables.
2. `pnpm cf:deploy` applies D1 migrations.
3. Wrangler deploys the new version while preserving existing Runtime Secrets.
4. The temporary files are removed.

The Console Build recompiles the React static assets and deploys the Console Worker. The two Workers can later be rolled back independently, but a Worker version rollback does not roll back D1 data or R2 objects.

## Optional: disable `workers.dev`

After validating the custom domains, you can reduce the number of public entry points. Change this setting in each applicable `wrangler.jsonc`:

```jsonc
"workers_dev": true
```

to:

```jsonc
"workers_dev": false
```

Commit and push the change. Both the API and Console must have working custom domains first, or they will lose their default entry points. When Worker-level Access protects the Console, its `workers.dev` address is covered by the same Access policy even if it remains enabled.

## Troubleshooting

### Console Build reports that the target service does not exist

Deploy `certbot-serverless-api` successfully before deploying the Console Worker. A Service Binding's target Worker must already exist.

### API Build reports missing secrets

For the first deployment, provide all five `RUNTIME_*` Bootstrap Build Secrets together. After a successful deployment, verify that all five unprefixed Runtime Secrets exist under the Worker's **Settings → Variables and Secrets**.

### D1 migration reports insufficient permissions

The default Build Token is normally sufficient. If the log explicitly reports a D1 permission error, create or select a custom Build Token with Worker deployment and D1 edit permissions under **Settings → Builds → API token**, then retry.

### Bearer requests are redirected to Access before the Worker runs

The API Worker or API domain is protected by Access. Remove that Access application. If the account uses **Protect all Workers**, configure a Worker-level public bypass for the API Worker.

### Download links use the wrong domain

Correct the API Build Variable `DOWNLOAD_URL_BASE` and redeploy the API Worker. Do not hard-code the domain in frontend code.

### Let's Encrypt issuance fails

Verify that the runtime `CLOUDFLARE_API_TOKEN` has both Zone Read and DNS Edit for the zone containing the certificate hostname, and confirm that the domain uses Cloudflare authoritative DNS.

### Origin CA creation or revocation fails

Verify that the runtime token has **SSL and Certificates → Edit** for the target zone and that the account member is allowed to use API access.

## Security checklist

- [ ] Worker-level Access protects every Console Worker entry point.
- [ ] The Console Allow policy contains only your exact email address or explicit account member.
- [ ] Browser-login Access does not protect the API Worker.
- [ ] Every `/api/*` request without credentials returns `401`.
- [ ] Every generated Deployment URL is limited to one certificate and can be revoked.
- [ ] Generated `.service` files containing Deployment URLs are installed with mode `0600`.
- [ ] All bootstrap `RUNTIME_*` values have been removed from the Build configuration.
- [ ] The five Runtime Secrets exist only in Worker secret storage and a password manager.
- [ ] `CLOUDFLARE_API_TOKEN` is restricted to the required zones and minimum permissions.
- [ ] `DOWNLOAD_URL_BASE` uses the final API HTTPS domain.
- [ ] D1 migrations are applied, and the R2 binding and Workflow are available.
- [ ] Preview branch builds are disabled or use fully isolated resources.
- [ ] Workers Logs and Traces are enabled.

## References

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
