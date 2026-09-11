import { AppError } from "./errors";
import type { CertificateAuthority, CertificateKeyType } from "./types";

export interface CreateCertificateInput {
  name: string;
  authority: CertificateAuthority;
  zoneId: string | null;
  domains: string[];
  keyType: CertificateKeyType;
  autoRenew: boolean;
  renewBeforeDays: number;
  originValidityDays: 7 | 30 | 90 | 365 | 730 | 1095 | 5475 | null;
  acmeEmail: string | null;
}

export interface CreateDeploymentInput {
  name: string;
}

const DOMAIN_PATTERN = /^(?:\*\.)?(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const ORIGIN_VALIDITIES = new Set([7, 30, 90, 365, 730, 1095, 5475]);

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_BODY", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function parseCreateCertificate(value: unknown): CreateCertificateInput {
  const body = objectValue(value);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    throw new AppError(400, "INVALID_NAME", "Name is required and must be at most 80 characters");
  }

  const authority = body.authority;
  if (authority !== "letsencrypt" && authority !== "cloudflare-origin") {
    throw new AppError(400, "INVALID_AUTHORITY", "Authority must be letsencrypt or cloudflare-origin");
  }

  const zoneId = body.zoneId ?? null;
  if (zoneId !== null && (typeof zoneId !== "string" || !/^[a-f0-9]{32}$/i.test(zoneId))) {
    throw new AppError(400, "INVALID_ZONE", "Select a valid Cloudflare site");
  }
  const useZoneDefaults = authority === "cloudflare-origin" && zoneId !== null;
  const domainValues = body.domains === undefined && useZoneDefaults ? [] : body.domains;
  if (!Array.isArray(domainValues)) {
    throw new AppError(400, "INVALID_DOMAINS", "Domains must be an array");
  }
  const domains = [...new Set(domainValues.map((item) => typeof item === "string" ? normalizeDomain(item) : ""))];
  const maxDomains = authority === "cloudflare-origin" ? 200 : 20;
  if ((domains.length === 0 && !useZoneDefaults) || domains.length > maxDomains || domains.some((domain) => !DOMAIN_PATTERN.test(domain))) {
    throw new AppError(400, "INVALID_DOMAINS", `Provide between 1 and ${maxDomains} valid DNS names${authority === "cloudflare-origin" ? " or select a Cloudflare site for default coverage" : ""}`);
  }

  const keyType = body.keyType ?? "ec-p256";
  if (keyType !== "ec-p256" && keyType !== "rsa-2048") {
    throw new AppError(400, "INVALID_KEY_TYPE", "Key type must be ec-p256 or rsa-2048");
  }

  const requestedValidity = Number(body.originValidityDays ?? 5475);
  if (authority === "cloudflare-origin" && !ORIGIN_VALIDITIES.has(requestedValidity)) {
    throw new AppError(400, "INVALID_VALIDITY", "Unsupported Cloudflare Origin CA validity");
  }

  const autoRenew = body.autoRenew !== false;
  const defaultRenewalDays = authority === "letsencrypt"
    ? 30
    : Math.min(60, Math.max(1, Math.floor(requestedValidity / 3)));
  const renewBeforeDays = Number(body.renewBeforeDays ?? defaultRenewalDays);
  if (!Number.isInteger(renewBeforeDays) || renewBeforeDays < 1 || renewBeforeDays > 180) {
    throw new AppError(400, "INVALID_RENEWAL_WINDOW", "Renewal window must be between 1 and 180 days");
  }

  const acmeEmail = typeof body.acmeEmail === "string" && body.acmeEmail.trim()
    ? body.acmeEmail.trim().toLowerCase()
    : null;
  if (authority === "letsencrypt" && (!acmeEmail || !/^\S+@\S+\.\S+$/.test(acmeEmail))) {
    throw new AppError(400, "INVALID_EMAIL", "A valid ACME contact email is required for Let's Encrypt");
  }

  const certificateLifetime = authority === "letsencrypt" ? 90 : requestedValidity;
  if (renewBeforeDays >= certificateLifetime) {
    throw new AppError(400, "INVALID_RENEWAL_WINDOW", "Renewal window must be shorter than the certificate lifetime");
  }

  return {
    name,
    authority,
    zoneId,
    domains,
    keyType,
    autoRenew,
    renewBeforeDays,
    originValidityDays: authority === "cloudflare-origin"
      ? requestedValidity as CreateCertificateInput["originValidityDays"]
      : null,
    acmeEmail,
  };
}

export function parseDownloadTtl(value: unknown): number {
  if (!value || typeof value !== "object") return 300;
  const seconds = Number((value as Record<string, unknown>).expiresIn ?? 300);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) {
    throw new AppError(400, "INVALID_EXPIRY", "Download links must expire in 30 to 3600 seconds");
  }
  return seconds;
}

export function parseCreateDeployment(value: unknown): CreateDeploymentInput {
  const body = objectValue(value);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80 || /[\r\n]/.test(name)) {
    throw new AppError(400, "INVALID_DEPLOYMENT_NAME", "Deployment name is required and must be at most 80 characters");
  }
  return { name };
}
