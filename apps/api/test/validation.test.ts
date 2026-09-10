import { describe, expect, it } from "vitest";
import { parseCreateCertificate, parseCreateDeployment, parseDownloadTtl } from "../src/validation";

describe("certificate input validation", () => {
  it("normalizes and de-duplicates DNS names", () => {
    const parsed = parseCreateCertificate({
      name: "Production",
      authority: "letsencrypt",
      domains: ["Example.com", "example.com.", "*.example.com"],
      acmeEmail: "OPS@Example.com",
    });
    expect(parsed.domains).toEqual(["example.com", "*.example.com"]);
    expect(parsed.acmeEmail).toBe("ops@example.com");
    expect(parsed.keyType).toBe("ec-p256");
  });

  it("requires an ACME email for Let's Encrypt", () => {
    expect(() => parseCreateCertificate({
      name: "Missing email",
      authority: "letsencrypt",
      domains: ["example.com"],
    })).toThrow(/email/i);
  });

  it("rejects a renewal window longer than the certificate", () => {
    expect(() => parseCreateCertificate({
      name: "Short origin",
      authority: "cloudflare-origin",
      domains: ["origin.example.com"],
      originValidityDays: 30,
      renewBeforeDays: 30,
    })).toThrow(/shorter/i);
  });
});

describe("download expiry validation", () => {
  it("uses five minutes by default", () => expect(parseDownloadTtl(null)).toBe(300));
  it("limits signed links to one hour", () => expect(() => parseDownloadTtl({ expiresIn: 3601 })).toThrow());
});

describe("deployment input validation", () => {
  it("trims a deployment name", () => {
    expect(parseCreateDeployment({ name: "  production origin  " })).toEqual({ name: "production origin" });
  });

  it("rejects empty and multiline names", () => {
    expect(() => parseCreateDeployment({ name: "" })).toThrow(/name/i);
    expect(() => parseCreateDeployment({ name: "first\nsecond" })).toThrow(/name/i);
  });
});
