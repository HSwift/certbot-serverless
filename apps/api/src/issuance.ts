import * as acme from "acme-client";
import { PemConverter, X509Certificate } from "@peculiar/x509";
import { certificateFingerprint, encryptBundle } from "./crypto";
import {
  createDnsTxtRecord,
  createOriginCertificate,
  deleteDnsRecord,
  findZone,
} from "./cloudflare-api";
import type {
  CertificateBundle,
  CertificateRow,
  Env,
  IssuedCertificate,
} from "./types";

function pemText(value: Buffer | string): string {
  const text = typeof value === "string" ? value : value.toString();
  return text.endsWith("\n") ? text : `${text}\n`;
}

async function createKeyAndCsr(
  domains: string[],
  keyType: CertificateRow["key_type"],
): Promise<{ privateKeyPem: string; csrPem: string }> {
  const privateKey = keyType === "ec-p256"
    ? await acme.crypto.createPrivateEcdsaKey("P-256")
    : await acme.crypto.createPrivateRsaKey(2048);
  const [, csr] = await acme.crypto.createCsr({
    commonName: domains[0],
    altNames: [...domains],
  }, privateKey);
  return { privateKeyPem: pemText(privateKey), csrPem: pemText(csr) };
}

function splitCertificateChain(fullchainPem: string): { certificatePem: string; chainPem: string } {
  const certificates = acme.crypto.splitPemChain(fullchainPem).map(pemText);
  const certificatePem = certificates[0];
  if (!certificatePem) throw new Error("Certificate authority returned an empty certificate chain");
  return { certificatePem, chainPem: certificates.slice(1).join("") };
}

async function issueLetsEncrypt(
  certificate: CertificateRow,
  env: Env,
  keyMaterial: { privateKeyPem: string; csrPem: string },
): Promise<{ fullchainPem: string; authorityCertificateId: null }> {
  if (!certificate.acme_email) throw new Error("Let's Encrypt certificate is missing an ACME email");
  if (!env.ACME_ACCOUNT_KEY) throw new Error("ACME_ACCOUNT_KEY secret is not configured");

  const client = new acme.Client({
    directoryUrl: env.ACME_DIRECTORY_URL,
    accountKey: env.ACME_ACCOUNT_KEY.replace(/\\n/g, "\n"),
  });
  const records = new Map<string, { zoneId: string; recordId: string }>();

  const fullchainPem = await client.auto({
    csr: keyMaterial.csrPem,
    email: certificate.acme_email,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    skipChallengeVerification: true,
    challengeCreateFn: async (authorization, challenge, keyAuthorization) => {
      if (challenge.type !== "dns-01") throw new Error(`Unsupported ACME challenge ${challenge.type}`);
      const hostname = authorization.identifier.value.replace(/^\*\./, "");
      const zone = await findZone(env.CLOUDFLARE_API_TOKEN, hostname);
      const recordId = await createDnsTxtRecord(
        env.CLOUDFLARE_API_TOKEN,
        zone.id,
        `_acme-challenge.${hostname}`,
        keyAuthorization,
      );
      records.set(challenge.url, { zoneId: zone.id, recordId });

      // Cloudflare authoritative DNS updates quickly; this delay avoids asking the CA
      // before the record is visible without spending extra Worker subrequests on polling.
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    },
    challengeRemoveFn: async (_authorization, challenge) => {
      const record = records.get(challenge.url);
      if (!record) return;
      await deleteDnsRecord(env.CLOUDFLARE_API_TOKEN, record.zoneId, record.recordId);
      records.delete(challenge.url);
    },
  });

  return { fullchainPem: pemText(fullchainPem), authorityCertificateId: null };
}

async function issueCloudflareOrigin(
  certificate: CertificateRow,
  env: Env,
  keyMaterial: { privateKeyPem: string; csrPem: string },
): Promise<{ fullchainPem: string; authorityCertificateId: string }> {
  const response = await createOriginCertificate(env.CLOUDFLARE_API_TOKEN, {
    csr: keyMaterial.csrPem,
    domains: JSON.parse(certificate.domains_json) as string[],
    keyType: certificate.key_type,
    validityDays: certificate.origin_validity_days ?? 5475,
  });
  return {
    fullchainPem: pemText(response.certificate),
    authorityCertificateId: response.id,
  };
}

export async function issueCertificate(
  certificate: CertificateRow,
  env: Env,
  versionId: string,
): Promise<IssuedCertificate> {
  const domains = JSON.parse(certificate.domains_json) as string[];
  const keyMaterial = await createKeyAndCsr(domains, certificate.key_type);
  const result = certificate.authority === "letsencrypt"
    ? await issueLetsEncrypt(certificate, env, keyMaterial)
    : await issueCloudflareOrigin(certificate, env, keyMaterial);
  const { certificatePem, chainPem } = splitCertificateChain(result.fullchainPem);
  const info = acme.crypto.readCertificateInfo(certificatePem);
  const parsedCertificate = new X509Certificate(PemConverter.decodeFirst(certificatePem));
  const bundle: CertificateBundle = {
    certificatePem,
    chainPem,
    fullchainPem: result.fullchainPem,
    privateKeyPem: keyMaterial.privateKeyPem,
    csrPem: keyMaterial.csrPem,
  };

  return {
    encryptedBundle: await encryptBundle(
      bundle,
      env.CERTIFICATE_MASTER_KEY,
      `${certificate.id}:${versionId}`,
    ),
    authorityCertificateId: result.authorityCertificateId,
    issuer: info.issuer.commonName ?? (certificate.authority === "letsencrypt" ? "Let's Encrypt" : "Cloudflare Origin CA"),
    serialNumber: parsedCertificate.serialNumber,
    fingerprintSha256: await certificateFingerprint(certificatePem),
    notBefore: info.notBefore.toISOString(),
    expiresAt: info.notAfter.toISOString(),
  };
}
