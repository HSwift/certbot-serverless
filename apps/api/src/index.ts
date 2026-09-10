import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { requireAuth, type AppContext } from "./auth";
import { revokeOriginCertificate } from "./cloudflare-api";
import { decryptBundle, hashToken, randomToken, secureEqual, signDownloadPayload } from "./crypto";
import { audit, createJob, getCertificate, getVersion, nowIso, publicCertificate, publicDeployment } from "./db";
import { AppError, errorMessage } from "./errors";
import type { CertificateRow, CertificateVersionRow, DeploymentTokenRow, EncryptedEnvelope, Env } from "./types";
import { parseCreateCertificate, parseCreateDeployment, parseDownloadTtl } from "./validation";
export { CertificateWorkflow } from "./workflow";

const app = new Hono<AppContext>();

app.get("/api/health", (context) => context.json({
  status: "ok",
  service: "certbot-serverless-api",
  time: new Date().toISOString(),
}));

app.use("/api/*", requireAuth);

app.get("/api/me", (context) => context.json({ actor: context.get("actor") }));

app.get("/api/overview", async (context) => {
  const [counts, expiring, jobs] = await Promise.all([
    context.env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN auto_renew = 1 THEN 1 ELSE 0 END) AS auto_renew
       FROM certificates`,
    ).first<Record<string, number>>(),
    context.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM certificates
       WHERE status = 'active' AND expires_at <= ?`,
    ).bind(new Date(Date.now() + 30 * 86_400_000).toISOString()).first<{ count: number }>(),
    context.env.DB.prepare(
      `SELECT jobs.*, certificates.name AS certificate_name
       FROM jobs JOIN certificates ON certificates.id = jobs.certificate_id
       ORDER BY jobs.created_at DESC LIMIT 8`,
    ).all(),
  ]);
  return context.json({
    summary: {
      total: Number(counts?.total ?? 0),
      active: Number(counts?.active ?? 0),
      failed: Number(counts?.failed ?? 0),
      autoRenew: Number(counts?.auto_renew ?? 0),
      expiring: Number(expiring?.count ?? 0),
    },
    recentJobs: jobs.results,
  });
});

app.get("/api/certificates", async (context) => {
  const status = context.req.query("status");
  const result = status
    ? await context.env.DB.prepare(
      "SELECT * FROM certificates WHERE status = ? ORDER BY created_at DESC LIMIT 200",
    ).bind(status).all<CertificateRow>()
    : await context.env.DB.prepare(
      "SELECT * FROM certificates ORDER BY created_at DESC LIMIT 200",
    ).all<CertificateRow>();
  return context.json({ certificates: result.results.map(publicCertificate) });
});

app.post("/api/certificates", async (context) => {
  const input = parseCreateCertificate(await context.req.json().catch(() => null));
  const id = crypto.randomUUID();
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO certificates
      (id, name, authority, primary_domain, domains_json, key_type, status, auto_renew,
       renew_before_days, origin_validity_days, acme_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.name,
    input.authority,
    input.domains[0],
    JSON.stringify(input.domains),
    input.keyType,
    input.autoRenew ? 1 : 0,
    input.renewBeforeDays,
    input.originValidityDays,
    input.acmeEmail,
    now,
    now,
  ).run();

  try {
    const job = await createJob(context.env, id, "issue");
    await audit(context.env.DB, context.get("actor"), "certificate.created", id, {
      authority: input.authority,
      domains: input.domains,
      jobId: job.id,
    });
    return context.json({ certificateId: id, job }, 202);
  } catch (error) {
    await context.env.DB.prepare(
      "UPDATE certificates SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
    ).bind(errorMessage(error), nowIso(), id).run();
    throw error;
  }
});

app.get("/api/certificates/:id", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  const [versions, jobs] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, certificate_id, authority_certificate_id, issuer, serial_number,
              fingerprint_sha256, not_before, expires_at, created_at
       FROM certificate_versions WHERE certificate_id = ? ORDER BY created_at DESC`,
    ).bind(certificate.id).all<Omit<CertificateVersionRow, "r2_key">>(),
    context.env.DB.prepare(
      "SELECT * FROM jobs WHERE certificate_id = ? ORDER BY created_at DESC LIMIT 20",
    ).bind(certificate.id).all(),
  ]);
  return context.json({
    certificate: publicCertificate(certificate),
    versions: versions.results,
    jobs: jobs.results,
  });
});

app.post("/api/certificates/:id/renew", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  const activeJob = await context.env.DB.prepare(
    "SELECT id FROM jobs WHERE certificate_id = ? AND status IN ('queued', 'running') LIMIT 1",
  ).bind(certificate.id).first<{ id: string }>();
  if (activeJob) throw new AppError(409, "JOB_IN_PROGRESS", "An issuance job is already in progress");
  const job = await createJob(context.env, certificate.id, "renew");
  await audit(context.env.DB, context.get("actor"), "certificate.renew.requested", certificate.id, { jobId: job.id });
  return context.json({ job }, 202);
});

app.patch("/api/certificates/:id", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  const body: Record<string, unknown> = await context.req.json<Record<string, unknown>>()
    .catch((): Record<string, unknown> => ({}));
  if (typeof body.autoRenew !== "boolean") {
    throw new AppError(400, "INVALID_BODY", "autoRenew must be a boolean");
  }
  await context.env.DB.prepare(
    "UPDATE certificates SET auto_renew = ?, updated_at = ? WHERE id = ?",
  ).bind(body.autoRenew ? 1 : 0, nowIso(), certificate.id).run();
  await audit(context.env.DB, context.get("actor"), "certificate.auto_renew.updated", certificate.id, {
    autoRenew: body.autoRenew,
  });
  return context.json({ ok: true });
});

app.post("/api/certificates/:id/download-link", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate?.current_version_id) throw new AppError(409, "NOT_READY", "Certificate has no downloadable version");
  const expiresIn = parseDownloadTtl(await context.req.json().catch(() => null));
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const nonce = crypto.randomUUID();
  const payload = `${certificate.id}.${certificate.current_version_id}.${expires}.${nonce}`;
  const signature = await signDownloadPayload(payload, context.env.DOWNLOAD_SIGNING_KEY);
  await context.env.DB.prepare(
    `INSERT INTO download_tokens
      (nonce, certificate_id, version_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(nonce, certificate.id, certificate.current_version_id, expires, nowIso()).run();
  const base = context.env.DOWNLOAD_URL_BASE.replace(/\/$/, "");
  const query = new URLSearchParams({
    version: certificate.current_version_id,
    expires: String(expires),
    nonce,
    signature,
  });
  await audit(context.env.DB, context.get("actor"), "certificate.download_link.created", certificate.id, {
    versionId: certificate.current_version_id,
    expires,
  });
  return context.json({ url: `${base}/download/${certificate.id}?${query}`, expiresAt: new Date(expires * 1_000).toISOString() });
});

app.get("/api/certificates/:id/deployments", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  const result = await context.env.DB.prepare(
    `SELECT * FROM deployment_tokens
     WHERE certificate_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 100`,
  ).bind(certificate.id).all<DeploymentTokenRow>();
  return context.json({ deployments: result.results.map(publicDeployment) });
});

app.post("/api/certificates/:id/deployments", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  if (!certificate.current_version_id) {
    throw new AppError(409, "NOT_READY", "Certificate has no deployable version");
  }
  const input = parseCreateDeployment(await context.req.json().catch(() => null));
  const id = crypto.randomUUID();
  const token = randomToken();
  const createdAt = nowIso();
  const deployment: DeploymentTokenRow = {
    id,
    certificate_id: certificate.id,
    name: input.name,
    token_hash: await hashToken(token),
    created_at: createdAt,
    last_used_at: null,
    last_version_id: null,
    revoked_at: null,
  };
  await context.env.DB.prepare(
    `INSERT INTO deployment_tokens
      (id, certificate_id, name, token_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, certificate.id, input.name, deployment.token_hash, createdAt).run();
  await audit(context.env.DB, context.get("actor"), "certificate.deployment.created", certificate.id, {
    deploymentId: id,
    name: input.name,
  });
  const base = context.env.DOWNLOAD_URL_BASE.replace(/\/$/, "");
  return context.json({
    deployment: publicDeployment(deployment),
    url: `${base}/deploy/${token}`,
  }, 201);
});

app.delete("/api/deployments/:id", async (context) => {
  const deployment = await context.env.DB.prepare(
    "SELECT * FROM deployment_tokens WHERE id = ? AND revoked_at IS NULL",
  ).bind(context.req.param("id")).first<DeploymentTokenRow>();
  if (!deployment) throw new AppError(404, "NOT_FOUND", "Deployment not found");
  await context.env.DB.prepare(
    "UPDATE deployment_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  ).bind(nowIso(), deployment.id).run();
  await audit(context.env.DB, context.get("actor"), "certificate.deployment.revoked", deployment.certificate_id, {
    deploymentId: deployment.id,
    name: deployment.name,
  });
  return context.json({ ok: true });
});

app.delete("/api/certificates/:id", async (context) => {
  const certificate = await getCertificate(context.env.DB, context.req.param("id"));
  if (!certificate) throw new AppError(404, "NOT_FOUND", "Certificate not found");
  const activeJob = await context.env.DB.prepare(
    "SELECT id FROM jobs WHERE certificate_id = ? AND status IN ('queued', 'running') LIMIT 1",
  ).bind(certificate.id).first<{ id: string }>();
  if (activeJob) throw new AppError(409, "JOB_IN_PROGRESS", "Wait for the active issuance job before deleting this certificate");
  const versions = await context.env.DB.prepare(
    "SELECT * FROM certificate_versions WHERE certificate_id = ?",
  ).bind(certificate.id).all<CertificateVersionRow>();
  for (const version of versions.results) {
    if (certificate.authority === "cloudflare-origin" && version.authority_certificate_id) {
      try {
        await revokeOriginCertificate(context.env.CLOUDFLARE_API_TOKEN, version.authority_certificate_id);
      } catch (error) {
        if (!(error instanceof AppError && error.status === 404)) throw error;
      }
    }
  }
  if (versions.results.length > 0) {
    await context.env.CERTIFICATES.delete(versions.results.map((version) => version.r2_key));
  }
  await audit(context.env.DB, context.get("actor"), "certificate.deleted", certificate.id, {
    name: certificate.name,
    versions: versions.results.length,
  });
  await context.env.DB.prepare("DELETE FROM certificates WHERE id = ?").bind(certificate.id).run();
  return context.json({ ok: true });
});

app.get("/api/jobs/:id", async (context) => {
  const job = await context.env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
    .bind(context.req.param("id")).first();
  if (!job) throw new AppError(404, "NOT_FOUND", "Job not found");
  return context.json({ job });
});

app.get("/api/audit", async (context) => {
  const result = await context.env.DB.prepare(
    "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100",
  ).all();
  return context.json({ events: result.results });
});

app.get("/deploy/:token", async (context) => {
  const token = context.req.param("token");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AppError(404, "NOT_FOUND", "Deployment URL not found");
  }
  const deployment = await context.env.DB.prepare(
    "SELECT * FROM deployment_tokens WHERE token_hash = ? AND revoked_at IS NULL",
  ).bind(await hashToken(token)).first<DeploymentTokenRow>();
  if (!deployment) throw new AppError(404, "NOT_FOUND", "Deployment URL not found");

  const certificate = await getCertificate(context.env.DB, deployment.certificate_id);
  if (!certificate?.current_version_id) {
    throw new AppError(409, "NOT_READY", "Certificate has no deployable version");
  }
  const version = await getVersion(context.env.DB, certificate.current_version_id);
  if (!version || version.certificate_id !== certificate.id) {
    throw new AppError(404, "NOT_FOUND", "Certificate version not found");
  }
  const archive = await createCertificateArchive(context.env, certificate, version);
  const usedAt = nowIso();
  const used = await context.env.DB.prepare(
    "UPDATE deployment_tokens SET last_used_at = ?, last_version_id = ? WHERE id = ? AND revoked_at IS NULL",
  ).bind(usedAt, version.id, deployment.id).run();
  if (used.meta.changes !== 1) {
    throw new AppError(404, "NOT_FOUND", "Deployment URL not found");
  }
  await audit(context.env.DB, `deployment:${deployment.id}`, "certificate.deployment.downloaded", certificate.id, {
    deploymentId: deployment.id,
    versionId: version.id,
  });
  return certificateArchiveResponse(archive, certificate.primary_domain);
});

app.get("/download/:id", async (context) => {
  const certificateId = context.req.param("id");
  const versionId = context.req.query("version") ?? "";
  const expiresValue = context.req.query("expires") ?? "";
  const nonce = context.req.query("nonce") ?? "";
  const signature = context.req.query("signature") ?? "";
  const expires = Number(expiresValue);
  if (!versionId || !nonce || !signature || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
    throw new AppError(403, "INVALID_DOWNLOAD", "Download link is invalid or expired");
  }
  const expected = await signDownloadPayload(
    `${certificateId}.${versionId}.${expires}.${nonce}`,
    context.env.DOWNLOAD_SIGNING_KEY,
  );
  if (!(await secureEqual(expected, signature))) {
    throw new AppError(403, "INVALID_DOWNLOAD", "Download link is invalid or expired");
  }
  const consumed = await context.env.DB.prepare(
    `UPDATE download_tokens SET consumed_at = ?
     WHERE nonce = ? AND certificate_id = ? AND version_id = ? AND expires_at = ?
       AND consumed_at IS NULL AND expires_at >= ?`,
  ).bind(nowIso(), nonce, certificateId, versionId, expires, Math.floor(Date.now() / 1000)).run();
  if (consumed.meta.changes !== 1) {
    throw new AppError(403, "DOWNLOAD_USED", "Download link is expired or has already been used");
  }

  const [certificate, version] = await Promise.all([
    getCertificate(context.env.DB, certificateId),
    getVersion(context.env.DB, versionId),
  ]);
  if (!certificate || !version || version.certificate_id !== certificate.id) {
    throw new AppError(404, "NOT_FOUND", "Certificate version not found");
  }
  const archive = await createCertificateArchive(context.env, certificate, version);
  return certificateArchiveResponse(archive, certificate.primary_domain);
});

async function createCertificateArchive(
  env: Env,
  certificate: CertificateRow,
  version: CertificateVersionRow,
): Promise<Uint8Array> {
  const object = await env.CERTIFICATES.get(version.r2_key);
  if (!object) throw new AppError(404, "NOT_FOUND", "Encrypted certificate bundle not found");
  const envelope = await object.json<EncryptedEnvelope>();
  const bundle = await decryptBundle(
    envelope,
    env.CERTIFICATE_MASTER_KEY,
    `${certificate.id}:${version.id}`,
  );
  const metadata = JSON.stringify({
    name: certificate.name,
    authority: certificate.authority,
    domains: JSON.parse(certificate.domains_json),
    issuer: version.issuer,
    fingerprintSha256: version.fingerprint_sha256,
    notBefore: version.not_before,
    expiresAt: version.expires_at,
  }, null, 2);
  return zipSync({
    "cert.pem": strToU8(bundle.certificatePem),
    "chain.pem": strToU8(bundle.chainPem),
    "fullchain.pem": strToU8(bundle.fullchainPem),
    "privkey.pem": strToU8(bundle.privateKeyPem),
    "request.csr": strToU8(bundle.csrPem),
    "metadata.json": strToU8(metadata),
  }, { level: 6 });
}

function certificateArchiveResponse(archive: Uint8Array, primaryDomain: string): Response {
  const filename = primaryDomain.replace(/^\*\./, "wildcard.").replace(/[^a-z0-9.-]/gi, "_");
  const body = new Uint8Array(archive.byteLength);
  body.set(archive);
  return new Response(body.buffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}.zip"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

app.notFound((context) => context.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404));

app.onError((error, context) => {
  if (error instanceof AppError) {
    return context.json({ error: { code: error.code, message: error.message } }, error.status as 400);
  }
  console.error(JSON.stringify({ event: "request_failed", message: errorMessage(error) }));
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
});

async function runRenewalSweep(env: Env): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT certificates.* FROM certificates
     WHERE auto_renew = 1
       AND status IN ('active', 'failed')
       AND next_renewal_at IS NOT NULL
       AND next_renewal_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM jobs
         WHERE jobs.certificate_id = certificates.id
           AND jobs.status IN ('queued', 'running')
       )
     ORDER BY next_renewal_at ASC LIMIT 20`,
  ).bind(nowIso()).all<CertificateRow>();
  for (const certificate of due.results) {
    try {
      await createJob(env, certificate.id, "renew");
    } catch (error) {
      console.error(JSON.stringify({
        event: "renewal_schedule_failed",
        certificateId: certificate.id,
        message: errorMessage(error),
      }));
    }
  }
  await env.DB.prepare("DELETE FROM download_tokens WHERE expires_at < ?")
    .bind(Math.floor(Date.now() / 1000) - 86_400).run();
  console.log(JSON.stringify({ event: "renewal_sweep", scheduled: due.results.length }));
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runRenewalSweep(env);
  },
} satisfies ExportedHandler<Env>;
