import { describe, expect, it } from "vitest";
import { decryptBundle, encryptBundle, secureEqual, signDownloadPayload } from "../src/crypto";
import type { CertificateBundle } from "../src/types";

const key = Buffer.alloc(32, 7).toString("base64");
const bundle: CertificateBundle = {
  certificatePem: "certificate",
  chainPem: "chain",
  fullchainPem: "certificate\nchain",
  privateKeyPem: "private",
  csrPem: "csr",
};

describe("certificate encryption", () => {
  it("round-trips a bundle with associated data", async () => {
    const encrypted = await encryptBundle(bundle, key, "cert:version");
    expect(encrypted.ciphertext).not.toContain("private");
    await expect(decryptBundle(encrypted, key, "cert:version")).resolves.toEqual(bundle);
  });

  it("rejects the wrong associated data", async () => {
    const encrypted = await encryptBundle(bundle, key, "cert:version");
    await expect(decryptBundle(encrypted, key, "other:version")).rejects.toThrow();
  });
});

describe("request signatures", () => {
  it("creates stable HMAC signatures", async () => {
    const left = await signDownloadPayload("payload", key);
    const right = await signDownloadPayload("payload", key);
    expect(await secureEqual(left, right)).toBe(true);
    expect(await secureEqual(left, `${right}x`)).toBe(false);
  });
});
