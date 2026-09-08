import { AppError } from "./errors";

interface CloudflareError {
  code?: number;
  message?: string;
}

interface CloudflareResponse<T> {
  success: boolean;
  result: T;
  errors?: CloudflareError[];
}

interface ZoneResult {
  id: string;
  name: string;
}

interface DnsRecordResult {
  id: string;
}

export interface OriginCertificateResult {
  id: string;
  certificate: string;
  expires_on: string;
}

async function cloudflareRequest<T>(
  apiToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  let payload: CloudflareResponse<T>;
  try {
    payload = await response.json<CloudflareResponse<T>>();
  } catch {
    throw new AppError(502, "CLOUDFLARE_API_ERROR", `Cloudflare API returned HTTP ${response.status}`);
  }

  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ")
      || `Cloudflare API returned HTTP ${response.status}`;
    throw new AppError(response.status === 401 || response.status === 403 ? 502 : response.status, "CLOUDFLARE_API_ERROR", message);
  }
  return payload.result;
}

export async function findZone(apiToken: string, hostname: string): Promise<ZoneResult> {
  const labels = hostname.replace(/^\*\./, "").split(".");
  for (let index = 0; index <= labels.length - 2; index += 1) {
    const candidate = labels.slice(index).join(".");
    const query = new URLSearchParams({ name: candidate, status: "active", per_page: "1" });
    const zones = await cloudflareRequest<ZoneResult[]>(apiToken, `/zones?${query}`);
    if (zones[0]) return zones[0];
  }
  throw new AppError(422, "ZONE_NOT_FOUND", `No active Cloudflare zone found for ${hostname}`);
}

export async function createDnsTxtRecord(
  apiToken: string,
  zoneId: string,
  name: string,
  content: string,
): Promise<string> {
  const record = await cloudflareRequest<DnsRecordResult>(apiToken, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "TXT",
      name,
      content,
      ttl: 60,
      comment: "Managed by certbot-serverless ACME DNS-01",
    }),
  });
  return record.id;
}

export async function deleteDnsRecord(
  apiToken: string,
  zoneId: string,
  recordId: string,
): Promise<void> {
  await cloudflareRequest<unknown>(apiToken, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

export async function createOriginCertificate(
  apiToken: string,
  input: {
    csr: string;
    domains: string[];
    keyType: "ec-p256" | "rsa-2048";
    validityDays: number;
  },
): Promise<OriginCertificateResult> {
  return cloudflareRequest<OriginCertificateResult>(apiToken, "/certificates", {
    method: "POST",
    body: JSON.stringify({
      csr: input.csr,
      hostnames: input.domains,
      request_type: input.keyType === "ec-p256" ? "origin-ecc" : "origin-rsa",
      requested_validity: input.validityDays,
    }),
  });
}

export async function revokeOriginCertificate(apiToken: string, certificateId: string): Promise<void> {
  await cloudflareRequest<unknown>(apiToken, `/certificates/${certificateId}`, { method: "DELETE" });
}
