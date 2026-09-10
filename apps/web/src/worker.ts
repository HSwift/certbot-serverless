type RequestForwarder = {
  fetch(request: Request): Response | Promise<Response>;
};

export type ConsoleRouterEnv = {
  API: RequestForwarder;
  ASSETS: RequestForwarder;
};

export function routeConsoleRequest(
  request: Request,
  env: ConsoleRouterEnv,
): Response | Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return env.API.fetch(request);
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request, env) {
    return routeConsoleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
