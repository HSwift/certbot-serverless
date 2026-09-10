import type { AuthActor, CertificateRow, CertificateVersionRow, DeploymentTokenRow, Env, JobKind } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getCertificate(db: D1Database, id: string): Promise<CertificateRow | null> {
  return db.prepare("SELECT * FROM certificates WHERE id = ?").bind(id).first<CertificateRow>();
}

export async function getVersion(db: D1Database, id: string): Promise<CertificateVersionRow | null> {
  return db.prepare("SELECT * FROM certificate_versions WHERE id = ?").bind(id).first<CertificateVersionRow>();
}

export async function createJob(
  env: Env,
  certificateId: string,
  kind: JobKind,
): Promise<{ id: string; workflowInstanceId: string }> {
  const jobId = crypto.randomUUID();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO jobs (id, certificate_id, workflow_instance_id, kind, status, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
  ).bind(jobId, certificateId, jobId, kind, createdAt).run();
  try {
    const instance = await env.CERTIFICATE_WORKFLOW.create({
      id: jobId,
      params: { certificateId, jobId, kind },
    });
    return { id: jobId, workflowInstanceId: instance.id };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
    ).bind(error instanceof Error ? error.message : "Unable to start workflow", nowIso(), jobId).run();
    throw error;
  }
}

export async function audit(
  db: D1Database,
  actor: AuthActor | string,
  action: string,
  certificateId: string | null,
  detail: Record<string, unknown> = {},
  auditId: string = crypto.randomUUID(),
): Promise<void> {
  const actorId = typeof actor === "string" ? actor : `${actor.method}:${actor.id}`;
  await db.prepare(
    "INSERT OR IGNORE INTO audit_log (id, actor, action, certificate_id, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(auditId, actorId, action, certificateId, JSON.stringify(detail), nowIso()).run();
}

export function publicCertificate(row: CertificateRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    authority: row.authority,
    primaryDomain: row.primary_domain,
    domains: JSON.parse(row.domains_json) as string[],
    keyType: row.key_type,
    status: row.status,
    autoRenew: row.auto_renew === 1,
    renewBeforeDays: row.renew_before_days,
    originValidityDays: row.origin_validity_days,
    issuer: row.issuer,
    serialNumber: row.serial_number,
    fingerprintSha256: row.fingerprint_sha256,
    notBefore: row.not_before,
    expiresAt: row.expires_at,
    nextRenewalAt: row.next_renewal_at,
    lastIssuedAt: row.last_issued_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicDeployment(row: DeploymentTokenRow): Record<string, unknown> {
  return {
    id: row.id,
    certificateId: row.certificate_id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastVersionId: row.last_version_id,
    revokedAt: row.revoked_at,
  };
}
