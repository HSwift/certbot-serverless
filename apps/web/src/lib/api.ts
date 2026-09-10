import type { Certificate, CreateCertificatePayload, Deployment, Overview } from "./types";

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as ApiErrorPayload;
    throw new Error(payload.error?.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  certificates: () => request<{ certificates: Certificate[] }>("/api/certificates"),
  createCertificate: (payload: CreateCertificatePayload) => request<{ certificateId: string }>("/api/certificates", {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  renew: (id: string) => request<{ job: { id: string } }>(`/api/certificates/${id}/renew`, { method: "POST" }),
  setAutoRenew: (id: string, autoRenew: boolean) => request<{ ok: boolean }>(`/api/certificates/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ autoRenew }),
  }),
  downloadLink: (id: string) => request<{ url: string; expiresAt: string }>(`/api/certificates/${id}/download-link`, {
    method: "POST",
    body: JSON.stringify({ expiresIn: 300 }),
  }),
  deployments: (id: string) => request<{ deployments: Deployment[] }>(`/api/certificates/${id}/deployments`),
  createDeployment: (id: string, name: string) => request<{ deployment: Deployment; url: string }>(`/api/certificates/${id}/deployments`, {
    method: "POST",
    body: JSON.stringify({ name }),
  }),
  revokeDeployment: (id: string) => request<{ ok: true }>(`/api/deployments/${id}`, { method: "DELETE" }),
};
