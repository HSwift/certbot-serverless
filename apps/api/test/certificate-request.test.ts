import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCertificateInput } from "../src/certificate-request";

const zoneId = "a".repeat(32);
const origin = { name: "Production origin", authority: "cloudflare-origin", zoneId };
const zone = { id: zoneId, name: "example.com", status: "active" };

afterEach(() => vi.unstubAllGlobals());

function mockZone(result = zone) {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ success: true, result }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("certificate hostname resolution", () => {
  it.each([{ domains: undefined }, { domains: [] }])("uses the site's apex and wildcard for $domains", async ({ domains }) => {
    const fetcher = mockZone();
    const input = await resolveCertificateInput({ ...origin, domains }, "scoped-token");
    expect(input.domains).toEqual(["example.com", "*.example.com"]);
    expect(input.acmeEmail).toBeNull();
    expect(input.originValidityDays).toBe(5475);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer scoped-token" }) }),
    );
  });

  it.each(["letsencrypt", "cloudflare-origin"])("preserves custom names inside the selected zone for %s", async (authority) => {
    mockZone();
    const input = await resolveCertificateInput({
      ...origin, authority, domains: ["Origin.Example.com.", "*.internal.example.com"], acmeEmail: "ops@example.com",
    }, "scoped-token");
    expect(input.domains).toEqual(["origin.example.com", "*.internal.example.com"]);
  });

  it.each(["letsencrypt", "cloudflare-origin"])("rejects unrelated domains and misleading suffixes for %s", async (authority) => {
    mockZone();
    for (const domain of ["other.com", "notexample.com", "example.com.attacker.com", "*.notexample.com"]) {
      await expect(resolveCertificateInput({
        ...origin, authority, domains: [domain], acmeEmail: "ops@example.com",
      }, "scoped-token")).rejects.toMatchObject({ code: "DOMAIN_OUTSIDE_ZONE" });
    }
  });

  it("rejects sites inaccessible to the configured token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: false, errors: [{ message: "Access denied" }],
    }, { status: 403 })));
    await expect(resolveCertificateInput(origin, "scoped-token")).rejects.toMatchObject({ code: "CLOUDFLARE_API_ERROR" });
  });

  it("rejects inactive sites even when a client supplies their ID directly", async () => {
    mockZone({ ...zone, status: "pending" });
    await expect(resolveCertificateInput(origin, "scoped-token")).rejects.toMatchObject({ code: "ZONE_NOT_ACTIVE" });
  });

  it.each(["letsencrypt", "cloudflare-origin"])("validates every zone for existing %s clients that supply only domains", async (authority) => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      const name = new URL(url).searchParams.get("name");
      return Response.json({ success: true, result: name === "example.com" ? [zone] : [] });
    });
    vi.stubGlobal("fetch", fetcher);
    const input = await resolveCertificateInput({
      ...origin, authority, zoneId: undefined, domains: ["example.com", "*.example.com"], acmeEmail: "ops@example.com",
    }, "scoped-token");
    expect(input.domains).toEqual(["example.com", "*.example.com"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(resolveCertificateInput({
      ...origin, authority, zoneId: undefined, domains: ["example.com", "unmanaged.com"], acmeEmail: "ops@example.com",
    }, "scoped-token")).rejects.toMatchObject({ code: "ZONE_NOT_FOUND" });
  });
});
