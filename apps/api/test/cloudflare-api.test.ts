import { afterEach, describe, expect, it, vi } from "vitest";
import { listZones } from "../src/cloudflare-api";

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare site selection", () => {
  it("lists all pages of active zones and exposes only IDs and names", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: String(index), name: `site${index}.com`, account: { id: "account-id" },
    }));
    const lastZone = { id: "last", name: "z.example.com" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, result: firstPage }))
      .mockResolvedValueOnce(Response.json({ success: true, result: [lastZone] }));
    vi.stubGlobal("fetch", fetcher);

    const zones = await listZones("scoped-token");
    expect(zones).toHaveLength(51);
    expect(zones[0]).toEqual({ id: "0", name: "site0.com" });
    expect(zones[50]).toEqual(lastZone);
    const queries = fetcher.mock.calls.map(([url]) => new URL(url).searchParams);
    expect(queries.map((query) => query.get("page"))).toEqual(["1", "2"]);
    expect(queries.every((query) => query.get("status") === "active")).toBe(true);
  });

  it("returns no options when the token has no active zones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, result: [] })));
    await expect(listZones("scoped-token")).resolves.toEqual([]);
  });
});
