import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { audit, getCertificate, nowIso } from "./db";
import { errorMessage } from "./errors";
import { issueCertificate } from "./issuance";
import type { CertificateWorkflowParams, Env } from "./types";

export class CertificateWorkflow extends WorkflowEntrypoint<Env, CertificateWorkflowParams> {
  async run(event: WorkflowEvent<CertificateWorkflowParams>, step: WorkflowStep): Promise<void> {
    const { certificateId, jobId, kind } = event.payload;
    // Workflow code can replay between durable steps. Deriving the version from the
    // unique job ID keeps the R2 key and AES-GCM associated data deterministic.
    const versionId = jobId;

    try {
      const certificate = await step.do("load certificate and mark running", async () => {
        const row = await getCertificate(this.env.DB, certificateId);
        if (!row) throw new Error("Certificate no longer exists");
        const now = nowIso();
        await this.env.DB.batch([
          this.env.DB.prepare(
            "UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?",
          ).bind(now, jobId),
          this.env.DB.prepare(
            "UPDATE certificates SET status = 'issuing', last_error = NULL, updated_at = ? WHERE id = ?",
          ).bind(now, certificateId),
        ]);
        return row;
      });

      const issued = await step.do(
        "issue and encrypt certificate",
        {
          retries: { limit: 1, delay: "5 seconds", backoff: "constant" },
          timeout: "15 minutes",
        },
        async () => issueCertificate(certificate, this.env, versionId),
      );

      const r2Key = `certificates/${certificateId}/${versionId}.json`;
      await step.do(
        "store encrypted certificate bundle",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          await this.env.CERTIFICATES.put(r2Key, JSON.stringify(issued.encryptedBundle), {
            httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
            customMetadata: { certificateId, versionId, encrypted: "true" },
          });
        },
      );

      await step.do("activate certificate", async () => {
        const finishedAt = nowIso();
        const nextRenewalAt = new Date(
          new Date(issued.expiresAt).getTime() - certificate.renew_before_days * 86_400_000,
        ).toISOString();
        await this.env.DB.batch([
          this.env.DB.prepare(
            `INSERT INTO certificate_versions
              (id, certificate_id, authority_certificate_id, r2_key, issuer, serial_number,
               fingerprint_sha256, not_before, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               authority_certificate_id = excluded.authority_certificate_id,
               r2_key = excluded.r2_key,
               issuer = excluded.issuer,
               serial_number = excluded.serial_number,
               fingerprint_sha256 = excluded.fingerprint_sha256,
               not_before = excluded.not_before,
               expires_at = excluded.expires_at`,
          ).bind(
            versionId,
            certificateId,
            issued.authorityCertificateId,
            r2Key,
            issued.issuer,
            issued.serialNumber,
            issued.fingerprintSha256,
            issued.notBefore,
            issued.expiresAt,
            finishedAt,
          ),
          this.env.DB.prepare(
            `UPDATE certificates SET
              status = 'active', current_version_id = ?, issuer = ?, serial_number = ?,
              fingerprint_sha256 = ?, not_before = ?, expires_at = ?, next_renewal_at = ?,
              last_issued_at = ?, last_error = NULL, updated_at = ?
             WHERE id = ?`,
          ).bind(
            versionId,
            issued.issuer,
            issued.serialNumber,
            issued.fingerprintSha256,
            issued.notBefore,
            issued.expiresAt,
            nextRenewalAt,
            finishedAt,
            finishedAt,
            certificateId,
          ),
          this.env.DB.prepare(
            "UPDATE jobs SET status = 'succeeded', finished_at = ? WHERE id = ?",
          ).bind(finishedAt, jobId),
        ]);
        await audit(
          this.env.DB,
          "system:workflow",
          `certificate.${kind}.succeeded`,
          certificateId,
          { versionId },
          `${jobId}:succeeded`,
        );
        console.log(JSON.stringify({ event: "certificate_issued", certificateId, jobId, versionId, authority: certificate.authority }));
      });
    } catch (error) {
      const message = errorMessage(error).slice(0, 2_000);
      await step.do("record issuance failure", async () => {
        const finishedAt = nowIso();
        await this.env.DB.batch([
          this.env.DB.prepare(
            "UPDATE certificates SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?",
          ).bind(message, finishedAt, certificateId),
          this.env.DB.prepare(
            "UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
          ).bind(message, finishedAt, jobId),
        ]);
        await audit(
          this.env.DB,
          "system:workflow",
          `certificate.${kind}.failed`,
          certificateId,
          { message },
          `${jobId}:failed`,
        );
        console.error(JSON.stringify({ event: "certificate_issue_failed", certificateId, jobId, message }));
      });
      throw error;
    }
  }
}
