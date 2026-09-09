import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const templatePath = resolve(apiRoot, "wrangler.jsonc");
const configPath = resolve(apiRoot, "wrangler.generated.jsonc");
const secretsPath = resolve(apiRoot, ".deploy-secrets.generated.json");

const deploymentVariableNames = [
  "D1_DATABASE_ID",
  "DOWNLOAD_URL_BASE",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
];

const runtimeSecretNames = {
  RUNTIME_CLOUDFLARE_API_TOKEN: "CLOUDFLARE_API_TOKEN",
  RUNTIME_API_BEARER_TOKEN: "API_BEARER_TOKEN",
  RUNTIME_DOWNLOAD_SIGNING_KEY: "DOWNLOAD_SIGNING_KEY",
  RUNTIME_CERTIFICATE_MASTER_KEY: "CERTIFICATE_MASTER_KEY",
  RUNTIME_ACME_ACCOUNT_KEY: "ACME_ACCOUNT_KEY",
};

function required(name, kind) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Cloudflare build ${kind}: ${name}`);
  return value;
}

function httpsUrl(name) {
  const value = required(name, "variable").replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return value;
}

function requireBase64Key(name) {
  const value = required(name, "secret");
  if (Buffer.from(value, "base64").byteLength !== 32) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`);
  }
  return value;
}

const deploymentVariables = Object.fromEntries(
  deploymentVariableNames.map((name) => [name, required(name, "variable")]),
);
deploymentVariables.DOWNLOAD_URL_BASE = httpsUrl("DOWNLOAD_URL_BASE");
deploymentVariables.ACCESS_TEAM_DOMAIN = httpsUrl("ACCESS_TEAM_DOMAIN");

const runtimeSecrets = Object.fromEntries(
  Object.entries(runtimeSecretNames).map(([buildName, runtimeName]) => [
    runtimeName,
    required(buildName, "secret"),
  ]),
);
runtimeSecrets.DOWNLOAD_SIGNING_KEY = requireBase64Key("RUNTIME_DOWNLOAD_SIGNING_KEY");
runtimeSecrets.CERTIFICATE_MASTER_KEY = requireBase64Key("RUNTIME_CERTIFICATE_MASTER_KEY");

if (!runtimeSecrets.ACME_ACCOUNT_KEY.includes("-----BEGIN PRIVATE KEY-----")) {
  throw new Error("RUNTIME_ACME_ACCOUNT_KEY must contain a PKCS#8 PEM private key");
}

let config;
try {
  config = JSON.parse(readFileSync(templatePath, "utf8"));
} catch (error) {
  throw new Error(`Unable to parse ${templatePath} as JSON-compatible JSONC`, { cause: error });
}

const database = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!database) throw new Error("The DB binding is missing from apps/api/wrangler.jsonc");

database.database_id = deploymentVariables.D1_DATABASE_ID;
config.vars = {
  ...config.vars,
  DOWNLOAD_URL_BASE: deploymentVariables.DOWNLOAD_URL_BASE,
  ACCESS_TEAM_DOMAIN: deploymentVariables.ACCESS_TEAM_DOMAIN,
  ACCESS_AUD: deploymentVariables.ACCESS_AUD,
};

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
writeFileSync(secretsPath, `${JSON.stringify(runtimeSecrets)}\n`, { mode: 0o600 });

console.log("Rendered temporary Cloudflare deployment files without printing their values.");
