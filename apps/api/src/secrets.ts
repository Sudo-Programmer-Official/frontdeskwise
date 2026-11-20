import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_ENVIRONMENT_VARIABLE = "FRONTDESKWISE_CREDENTIAL_KEY";

function credentialKey(): Buffer {
  const configured = process.env[KEY_ENVIRONMENT_VARIABLE]?.trim();
  if (!configured) {
    throw new Error(`${KEY_ENVIRONMENT_VARIABLE} is required to persist integration credentials`);
  }

  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex");

  try {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to the length check below so the operator gets one safe error.
  }

  if (Buffer.byteLength(configured, "utf8") === 32) return Buffer.from(configured, "utf8");
  throw new Error(`${KEY_ENVIRONMENT_VARIABLE} must be a 32-byte value, 64-character hex, or base64-encoded key`);
}

export function credentialsConfigured(): boolean {
  try {
    credentialKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = payload.split(".");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) throw new Error("Unsupported encrypted credential format");
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function credentialFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

/**
 * A display-only hint for credentials that have already been stored encrypted.
 * This intentionally keeps only the final four characters and is never used
 * to authenticate a provider.
 */
export function credentialHint(secret: string): string {
  const value = secret.trim();
  return `••••${value.slice(-4)}`;
}
