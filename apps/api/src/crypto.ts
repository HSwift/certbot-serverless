import type { CertificateBundle, EncryptedEnvelope } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeKey(value: string, label: string): Uint8Array {
  let key: Uint8Array;
  try {
    key = base64ToBytes(value);
  } catch {
    throw new Error(`${label} must be a base64-encoded 32-byte key`);
  }
  if (key.byteLength !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte key`);
  }
  return key;
}

export async function encryptBundle(
  bundle: CertificateBundle,
  masterKey: string,
  associatedData: string,
): Promise<EncryptedEnvelope> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(decodeKey(masterKey, "CERTIFICATE_MASTER_KEY")),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ownedBuffer(iv), additionalData: ownedBuffer(encoder.encode(associatedData)) },
    key,
    ownedBuffer(encoder.encode(JSON.stringify(bundle))),
  );
  return {
    version: 1,
    algorithm: "A256GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
  };
}

export async function decryptBundle(
  envelope: EncryptedEnvelope,
  masterKey: string,
  associatedData: string,
): Promise<CertificateBundle> {
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM") {
    throw new Error("Unsupported encrypted certificate format");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(decodeKey(masterKey, "CERTIFICATE_MASTER_KEY")),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ownedBuffer(base64ToBytes(envelope.iv)),
      additionalData: ownedBuffer(encoder.encode(associatedData)),
    },
    key,
    ownedBuffer(base64ToBytes(envelope.ciphertext)),
  );
  return JSON.parse(decoder.decode(decrypted)) as CertificateBundle;
}

export async function signDownloadPayload(payload: string, signingKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    ownedBuffer(decodeKey(signingKey, "DOWNLOAD_SIGNING_KEY")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, ownedBuffer(encoder.encode(payload)));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", ownedBuffer(encoder.encode(left))),
    crypto.subtle.digest("SHA-256", ownedBuffer(encoder.encode(right))),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(encoder.encode(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function certificateFingerprint(pem: string): Promise<string> {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(base64ToBytes(body)));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}

export function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
