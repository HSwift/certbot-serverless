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

  it.each([{ domains: undefined }, { domains: [] }])("still requires explicit Let's Encrypt domains when a zone is selected ($domains)", ({ domains }) => {
    expect(() => parseCreateCertificate({
      name: "Public certificate", authority: "letsencrypt", zoneId: "a".repeat(32), domains, acmeEmail: "ops@example.com",
    })).toThrow(/domains|DNS names/i);
  });

  it("requires a site for Origin CA default coverage", () => {
    expect(() => parseCreateCertificate({ name: "Origin", authority: "cloudflare-origin", domains: [] })).toThrow(/site/i);
  });

  it.each(["", "../zones", 42])("rejects an invalid site ID (%j)", (zoneId) => {
    expect(() => parseCreateCertificate({ name: "Origin", authority: "cloudflare-origin", zoneId })).toThrow(/site/i);
  });

  it.each([null, "example.com", [""], ["*.*.example.com"], [42]].map((domains) => ({ domains })))("rejects malformed custom hostnames instead of falling back to defaults ($domains)", ({ domains }) => {
    expect(() => parseCreateCertificate({
      name: "Origin", authority: "cloudflare-origin", zoneId: "a".repeat(32), domains,
    })).toThrow(/domains|DNS names/i);
  });

  it("supports 200 Origin CA SANs while retaining the Let's Encrypt limit", () => {
    const input = { name: "Origin", authority: "cloudflare-origin", domains: Array.from({ length: 200 }, (_, index) => `host${index}.example.com`) };
    expect(parseCreateCertificate(input).domains).toHaveLength(200);
    expect(() => parseCreateCertificate({ ...input, domains: [...input.domains, "extra.example.com"] })).toThrow(/200/);
    expect(() => parseCreateCertificate({ ...input, authority: "letsencrypt", acmeEmail: "ops@example.com" })).toThrow(/20/);
  });

  it.each([7, 30, 90, 365, 730, 1095, 5475])("uses a valid default renewal window for %i-day Origin CA certificates", (originValidityDays) => {
    const input = parseCreateCertificate({
      name: "Origin", authority: "cloudflare-origin", zoneId: "a".repeat(32), originValidityDays,
    });
    expect(input.renewBeforeDays).toBeLessThan(originValidityDays);
    expect(input.renewBeforeDays).toBeGreaterThanOrEqual(1);
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
