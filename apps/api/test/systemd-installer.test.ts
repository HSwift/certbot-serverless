import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderSystemdInstaller, renderSystemdUnits, type SystemdUnitOptions } from "../../../shared/systemd";

const options: SystemdUnitOptions = {
  certificateName: "Production origin", unitName: "production-origin", interval: "12h",
  destinationDirectory: "/etc/certs/origin eu's $HOME 100%",
  deploymentUrl: "https://cert-api.example.com/deploy/" + "a".repeat(43),
};
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "certbot-installer-test-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  const temp = join(directory, "tmp");
  mkdirSync(bin);
  mkdirSync(temp);
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, TMPDIR: temp, CERTBOT_TEST_DIR: directory };
  function command(name: string, source: string) {
    writeFileSync(join(bin, name), "#!" + process.execPath + "\n" + source, { mode: 0o755 });
  }
  // Every install/systemctl call is intercepted; only this temporary directory can be modified.
  command("id", "console.log(process.env.CERTBOT_TEST_UID || '0')");
  command("curl", "process.exit(0)");
  command("unzip", "process.exit(0)");
  command("systemctl", [
    "require('node:fs').appendFileSync(process.env.CERTBOT_TEST_DIR + '/systemctl.log', process.argv.slice(2).join(' ') + '\\n');",
    "process.exit(Number(process.env.CERTBOT_TEST_SYSTEMCTL_EXIT || '0'));",
  ].join("\n"));
  command("install", [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const target = args.at(-1);",
    "if (target !== '/etc/systemd/system' && !/^\\/etc\\/systemd\\/system\\/certbot-sync-[a-z0-9_.-]+\\.(service|timer)$/.test(target)) throw Error('Unexpected install target');",
    "const output = process.env.CERTBOT_TEST_DIR + target.replace('/etc/systemd/system', '/units');",
    "const mode = parseInt(args[args.indexOf('-m') + 1], 8);",
    "if (args.includes('-d')) fs.mkdirSync(output, { recursive: true, mode });",
    "else { fs.copyFileSync(args.at(-2), output); fs.chmodSync(output, mode); }",
  ].join("\n"));
  return { directory, temp, env, command };
}

describe("systemd installation scripts", () => {
  it("installs the exact generated units with appropriate permissions and starts synchronization", () => {
    const { directory, temp, env } = fixture();
    const marker = join(directory, "must-not-execute");
    const customOptions = { ...options, certificateName: "Origin $(touch " + marker + ") `touch " + marker + "`" };
    const units = renderSystemdUnits(customOptions);
    const result = spawnSync("/bin/sh", ["-s"], { input: renderSystemdInstaller(customOptions), env, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    for (const [filename, content, mode] of [
      [units.serviceFileName, units.service, 0o600],
      [units.timerFileName, units.timer, 0o644],
    ] as const) {
      const path = join(directory, "units", filename);
      expect(readFileSync(path, "utf8")).toBe(content);
      expect(statSync(path).mode & 0o777).toBe(mode);
    }
    expect(readFileSync(join(directory, "systemctl.log"), "utf8").trim().split("\n")).toEqual([
      "show-environment", "daemon-reload", "enable " + units.timerFileName,
      "restart " + units.timerFileName, "start " + units.serviceFileName,
    ]);
    expect(readdirSync(temp)).toEqual([]);
  });

  it.each([
    { CERTBOT_TEST_UID: "1000", CERTBOT_TEST_SYSTEMCTL_EXIT: "0", message: "root" },
    { CERTBOT_TEST_UID: "0", CERTBOT_TEST_SYSTEMCTL_EXIT: "1", message: "systemd" },
  ])("fails before writing units when prerequisites fail: $message", (settings) => {
    const { directory, env } = fixture();
    const result = spawnSync("/bin/sh", ["-s"], {
      input: renderSystemdInstaller(options), env: { ...env, ...settings }, encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(settings.message);
    expect(existsSync(join(directory, "units"))).toBe(false);
  });

  it.each(["0", "1000"])("downloads the selected installer and executes it as root (user %s)", (uid) => {
    const { directory, temp, env, command } = fixture();
    const marker = join(directory, "executed");
    command("curl", [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(process.env.CERTBOT_TEST_DIR + '/curl.json', JSON.stringify(args));",
      "fs.writeFileSync(args[args.indexOf('-o') + 1], 'touch \"$CERTBOT_TEST_DIR/executed\"\\n');",
    ].join("\n"));
    command("sudo", [
      "require('node:fs').writeFileSync(process.env.CERTBOT_TEST_DIR + '/sudo', 'called');",
      "const result = require('node:child_process').spawnSync(process.argv[2], process.argv.slice(3), { stdio: 'inherit' });",
      "process.exit(result.status ?? 1);",
    ].join("\n"));
    const result = spawnSync("/bin/sh", ["-c", renderSystemdUnits(options).installCommand], {
      env: { ...env, CERTBOT_TEST_UID: uid }, encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(existsSync(join(directory, "sudo"))).toBe(uid !== "0");
    const args: string[] = JSON.parse(readFileSync(join(directory, "curl.json"), "utf8"));
    const url = new URL(args[1]!);
    expect(args[0]).toBe("-fsSL");
    expect(url.origin + url.pathname).toBe(options.deploymentUrl + "/install.sh");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      unitName: options.unitName, destination: options.destinationDirectory, interval: options.interval,
    });
    expect(readdirSync(temp)).toEqual([]);
  });

  it("never executes a partial download and cleans up the temporary file", () => {
    const { directory, temp, env, command } = fixture();
    command("curl", [
      "const args = process.argv.slice(2);",
      "require('node:fs').writeFileSync(args[args.indexOf('-o') + 1], 'touch \"$CERTBOT_TEST_DIR/executed\"\\n');",
      "process.exit(22);",
    ].join("\n"));
    const result = spawnSync("/bin/sh", ["-c", renderSystemdUnits(options).installCommand], { env, encoding: "utf8" });
    expect(result.status).toBe(22);
    expect(existsSync(join(directory, "executed"))).toBe(false);
    expect(readdirSync(temp)).toEqual([]);
  });
});
