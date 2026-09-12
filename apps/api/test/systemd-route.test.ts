import { describe, expect, it, vi } from "vitest";
import { renderSystemdInstaller } from "../../../shared/systemd";
import { hashToken } from "../src/crypto";
import worker from "../src/index";

vi.mock("../src/workflow", () => ({ CertificateWorkflow: class {} }));

const token = "a".repeat(43);
const baseUrl = "https://cert-api.example.com";
const deployment = { id: "deployment-1", certificate_id: "cert-1", name: "Origin EU" };

function fixture({ active = true, ready = true } = {}) {
  const first = vi.fn().mockResolvedValueOnce(active ? deployment : null)
    .mockResolvedValueOnce({ id: "cert-1", name: "Production origin", current_version_id: ready ? "v1" : null });
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { env: { DB: { prepare }, DOWNLOAD_URL_BASE: baseUrl }, prepare, bind, run };
}

describe("systemd installer endpoint", () => {
  it("authenticates the deployment token and renders the selected units without console login", async () => {
    const { env, prepare, bind, run } = fixture();
    const params = new URLSearchParams({ unitName: "origin-eu", destination: "/etc/certs/origin eu", interval: "12h" });
    const response = await worker.fetch(new Request(`${baseUrl}/deploy/${token}/install.sh?${params}`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/x-shellscript");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toBe(renderSystemdInstaller({
      certificateName: "Production origin", deploymentUrl: `${baseUrl}/deploy/${token}`,
      destinationDirectory: "/etc/certs/origin eu", interval: "12h", unitName: "origin-eu",
    }));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("token_hash = ? AND revoked_at IS NULL"));
    expect(bind).toHaveBeenNthCalledWith(1, await hashToken(token));
    expect(bind).toHaveBeenNthCalledWith(2, "cert-1");
    expect(run).toHaveBeenCalledOnce();
  });

  it("defaults to the deployment's name and a six-hour interval", async () => {
    const { env } = fixture();
    const response = await worker.fetch(new Request(`${baseUrl}/deploy/${token}/install.sh`), env);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("certbot-sync-origin-eu.service");
    expect(body).toContain("/etc/certbot-serverless/origin-eu/privkey.pem");
    expect(body).toContain("OnUnitActiveSec=6h");
  });

  it.each(["", "/install.sh"])("rejects invalid and revoked tokens for /deploy/:token%s", async (suffix) => {
    const { env, prepare } = fixture({ active: false });
    const invalid = await worker.fetch(new Request(`${baseUrl}/deploy/invalid${suffix}`), env);
    expect(invalid.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
    const revoked = await worker.fetch(new Request(`${baseUrl}/deploy/${token}${suffix}`), env);
    expect(revoked.status).toBe(404);
    expect(await revoked.text()).not.toContain("#!/bin/sh");
  });

  it.each([
    ["unitName", "origin;reboot"], ["destination", "relative/path"],
    ["destination", "/etc/../root"], ["destination", "/etc/certs\nreboot"], ["interval", "1h\nreboot"],
  ])("rejects invalid %s=%s before returning a script", async (key, value) => {
    const { env, run } = fixture();
    const response = await worker.fetch(new Request(`${baseUrl}/deploy/${token}/install.sh?${new URLSearchParams({ [key]: value })}`), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_SYSTEMD_OPTIONS" } });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects certificates without a deployable version", async () => {
    const { env, run } = fixture({ ready: false });
    const response = await worker.fetch(new Request(`${baseUrl}/deploy/${token}/install.sh`), env);
    expect(response.status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });
});
