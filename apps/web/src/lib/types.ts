export type Authority = "letsencrypt" | "cloudflare-origin";
export type CertificateStatus = "pending" | "issuing" | "active" | "failed" | "revoked";

export interface Certificate {
  id: string;
  name: string;
  authority: Authority;
  primaryDomain: string;
  domains: string[];
  keyType: "ec-p256" | "rsa-2048";
  status: CertificateStatus;
  autoRenew: boolean;
  renewBeforeDays: number;
  originValidityDays: number | null;
  issuer: string | null;
  serialNumber: string | null;
  fingerprintSha256: string | null;
  notBefore: string | null;
  expiresAt: string | null;
  nextRenewalAt: string | null;
  lastIssuedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  certificate_id: string;
  certificate_name?: string;
  kind: "issue" | "renew";
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Overview {
  summary: { total: number; active: number; failed: number; autoRenew: number; expiring: number };
  recentJobs: Job[];
}

export interface CreateCertificatePayload {
  name: string;
  authority: Authority;
  domains?: string[];
  zoneId?: string;
  keyType: "ec-p256" | "rsa-2048";
  autoRenew: boolean;
  renewBeforeDays?: number;
  originValidityDays?: number;
  acmeEmail?: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
}

export interface DownloadLink {
  url: string;
  expiresAt: string;
}

export interface Deployment {
  id: string;
  certificateId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastVersionId: string | null;
  revokedAt: string | null;
}
