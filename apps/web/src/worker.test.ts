import { describe, expect, it, vi } from "vitest";
import { routeConsoleRequest } from "./worker";

function createRouterEnv() {
  return {
    API: {
      fetch: vi.fn(async (_request: Request) => new Response("api")),
    },
    ASSETS: {
      fetch: vi.fn(async (_request: Request) => new Response("asset")),
    },
  };
}

describe("console worker routing", () => {
  it.each(["/api", "/api/overview", "/api/certificates?id=1"])(
    "forwards %s to the API service binding",
    async (path) => {
      const env = createRouterEnv();
      const request = new Request(`https://console.example.com${path}`, {
        headers: { "Cf-Access-Jwt-Assertion": "access-jwt" },
      });

      const response = await routeConsoleRequest(request, env);

      expect(await response.text()).toBe("api");
      expect(env.API.fetch).toHaveBeenCalledWith(request);
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
      const forwarded = env.API.fetch.mock.calls[0]?.[0];
      expect(forwarded?.headers.get("Cf-Access-Jwt-Assertion")).toBe("access-jwt");
    },
  );

  it("serves non-API requests from the static asset binding", async () => {
    const env = createRouterEnv();
    const request = new Request("https://console.example.com/settings");

    const response = await routeConsoleRequest(request, env);

    expect(await response.text()).toBe("asset");
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
    expect(env.API.fetch).not.toHaveBeenCalled();
  });
});
