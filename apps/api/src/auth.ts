import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { secureEqual } from "./crypto";
import type { AuthActor, Env } from "./types";

export type AppContext = {
  Bindings: Env;
  Variables: { actor: AuthActor };
};

async function authenticateAccess(request: Request, env: Env): Promise<AuthActor | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;

  const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/\/$/, "");
  if (!teamDomain.startsWith("https://") || !env.ACCESS_AUD || env.ACCESS_AUD.startsWith("replace-")) {
    return null;
  }

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience: env.ACCESS_AUD,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    const commonName = typeof payload.common_name === "string" ? payload.common_name : null;
    return {
      id: email ?? commonName ?? payload.sub ?? "access-user",
      method: "access",
    };
  } catch {
    return null;
  }
}

async function authenticateBearer(request: Request, env: Env): Promise<AuthActor | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !env.API_BEARER_TOKEN) return null;
  const candidate = authorization.slice("Bearer ".length);
  if (!(await secureEqual(candidate, env.API_BEARER_TOKEN))) return null;
  return { id: "api-token", method: "bearer" };
}

export const requireAuth: MiddlewareHandler<AppContext> = async (context, next) => {
  const [accessActor, bearerActor] = await Promise.all([
    authenticateAccess(context.req.raw, context.env),
    authenticateBearer(context.req.raw, context.env),
  ]);
  const actor = accessActor ?? bearerActor;
  if (!actor) {
    return context.json({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid Cloudflare Access assertion or Bearer token is required",
      },
    }, 401);
  }
  context.set("actor", actor);
  await next();
};
