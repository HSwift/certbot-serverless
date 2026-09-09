import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const configFile = "wrangler.generated.jsonc";
const secretsFile = ".deploy-secrets.generated.json";
const configPath = resolve(apiRoot, configFile);
const secretsPath = resolve(apiRoot, secretsFile);

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pnpm", args, {
      cwd: apiRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`pnpm ${args.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

if (!existsSync(configPath) || !existsSync(secretsPath)) {
  throw new Error("Generated deployment files are missing. Run `pnpm cf:render` first.");
}

try {
  await run([
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "-c",
    configFile,
  ]);
  await run([
    "exec",
    "wrangler",
    "deploy",
    "-c",
    configFile,
    "--secrets-file",
    secretsFile,
  ]);
} finally {
  rmSync(configPath, { force: true });
  rmSync(secretsPath, { force: true });
}
