export type CertificateAuthority = "letsencrypt" | "cloudflare-origin";
export type CertificateKeyType = "ec-p256" | "rsa-2048";
export type CertificateStatus = "pending" | "issuing" | "active" | "failed" | "revoked";
export type JobKind = "issue" | "renew";

export type Env = Cloudflare.Env;

export interface CertificateWorkflowParams {
  certificateId: string;
  jobId: string;
  kind: JobKind;
}

export interface CertificateRow {
  id: string;
  name: string;
  authority: CertificateAuthority;
  primary_domain: string;
  domains_json: string;
  key_type: CertificateKeyType;
  status: CertificateStatus;
  auto_renew: number;
  renew_before_days: number;
  origin_validity_days: number | null;
  acme_email: string | null;
  current_version_id: string | null;
  issuer: string | null;
  serial_number: string | null;
  fingerprint_sha256: string | null;
  not_before: string | null;
  expires_at: string | null;
  next_renewal_at: string | null;
  last_issued_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CertificateVersionRow {
  id: string;
  certificate_id: string;
  authority_certificate_id: string | null;
  r2_key: string;
  issuer: string;
  serial_number: string | null;
  fingerprint_sha256: string;
  not_before: string;
  expires_at: string;
  created_at: string;
}

export interface CertificateBundle {
  certificatePem: string;
  chainPem: string;
  fullchainPem: string;
  privateKeyPem: string;
  csrPem: string;
}

export interface EncryptedEnvelope {
  version: 1;
  algorithm: "A256GCM";
  iv: string;
  ciphertext: string;
}

export interface IssuedCertificate {
  encryptedBundle: EncryptedEnvelope;
  authorityCertificateId: string | null;
  issuer: string;
  serialNumber: string | null;
  fingerprintSha256: string;
  notBefore: string;
  expiresAt: string;
}

export interface AuthActor {
  id: string;
  method: "access" | "bearer";
}
