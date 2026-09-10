import { describe, expect, it } from "vitest";
import { renderSystemdUnits, suggestedUnitName } from "./systemd";

describe("systemd synchronization units", () => {
  it("renders self-contained service and timer files", () => {
    const rendered = renderSystemdUnits({
      certificateName: "Production Origin",
      deploymentUrl: "https://cert-api.example.com/deploy/secret-token",
      destinationDirectory: "/etc/certificates/production",
      interval: "6h",
      unitName: "production-origin",
    });

    expect(rendered.serviceFileName).toBe("certbot-sync-production-origin.service");
    expect(rendered.timerFileName).toBe("certbot-sync-production-origin.timer");
    expect(rendered.service).toContain("https://cert-api.example.com/deploy/secret-token");
    expect(rendered.service).toContain('"/etc/certificates/production/privkey.pem"');
    expect(rendered.service).toContain("/usr/bin/unzip");
    expect(rendered.service).not.toMatch(/nginx|reload/i);
    expect(rendered.timer).toContain("OnUnitActiveSec=6h");
    expect(rendered.timer).toContain("Unit=certbot-sync-production-origin.service");
  });

  it("normalizes certificate names for systemd units", () => {
    expect(suggestedUnitName("  Production Origin / EU  ")).toBe("production-origin-eu");
  });

  it("rejects unsafe or ambiguous destinations", () => {
    expect(() => renderSystemdUnits({
      certificateName: "Example",
      deploymentUrl: "https://cert-api.example.com/deploy/token",
      destinationDirectory: "../certificates",
      interval: "1h",
      unitName: "example",
    })).toThrow(/absolute/i);

    expect(() => renderSystemdUnits({
      certificateName: "Example",
      deploymentUrl: "https://cert-api.example.com/deploy/token",
      destinationDirectory: "/etc/../root",
      interval: "1h",
      unitName: "example",
    })).toThrow(/traversal/i);
  });
});
