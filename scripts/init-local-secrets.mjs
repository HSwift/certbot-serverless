import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = resolve(root, "apps/api/.dev.vars");
const webPath = resolve(root, "apps/web/.env.local");

if ((existsSync(apiPath) || existsSync(webPath)) && !process.argv.includes("--force")) {
  console.error("Local secret files already exist. Re-run with --force to replace them.");
  process.exit(1);
}

const apiToken = randomBytes(32).toString("base64url");
const signingKey = randomBytes(32).toString("base64");
const masterKey = randomBytes(32).toString("base64");
const { privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const escapedAccountKey = privateKey.trim().replace(/\n/g, "\\n");

mkdirSync(dirname(apiPath), { recursive: true });
writeFileSync(apiPath, [
  'CLOUDFLARE_API_TOKEN="replace-with-a-scoped-cloudflare-api-token"',
  `API_BEARER_TOKEN="${apiToken}"`,
  `DOWNLOAD_SIGNING_KEY="${signingKey}"`,
  `CERTIFICATE_MASTER_KEY="${masterKey}"`,
  `ACME_ACCOUNT_KEY="${escapedAccountKey}"`,
  'ACME_DIRECTORY_URL="https://acme-staging-v02.api.letsencrypt.org/directory"',
  'DOWNLOAD_URL_BASE="http://localhost:8788"',
  "",
].join("\n"), { mode: 0o600 });
writeFileSync(webPath, `LOCAL_API_BEARER_TOKEN="${apiToken}"\n`, { mode: 0o600 });

console.log("Created apps/api/.dev.vars and apps/web/.env.local with mode 0600.");
console.log("Replace CLOUDFLARE_API_TOKEN before testing certificate issuance.");
