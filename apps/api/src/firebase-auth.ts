import { createPublicKey, createVerify } from "node:crypto";

type FirebaseClaims = Record<string, unknown>;

type CertificateCache = {
  certificates: Record<string, string>;
  expiresAt: number;
};

const FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certificateCache: CertificateCache | null = null;

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Invalid Firebase token encoding");
  }
}

async function firebaseCertificates(): Promise<Record<string, string>> {
  if (certificateCache && certificateCache.expiresAt > Date.now()) return certificateCache.certificates;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new Error("Unable to fetch Firebase signing certificates");
  const payload = await response.json() as Record<string, unknown>;
  const certificates = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => typeof value === "string") as Array<[string, string]>,
  );
  certificateCache = { certificates, expiresAt: Date.now() + 60 * 60 * 1_000 };
  return certificates;
}

function requiredStringClaim(claims: FirebaseClaims, key: string): string {
  const value = claims[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Firebase token is missing ${key}`);
  return value.trim();
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebaseClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Firebase token");
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header.alg !== "RS256") throw new Error("Firebase token uses an unsupported algorithm");
  const keyId = requiredStringClaim(header, "kid");
  const certificate = (await firebaseCertificates())[keyId];
  if (!certificate) throw new Error("Firebase signing key was not found");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(createPublicKey(certificate), Buffer.from(parts[2], "base64url"))) {
    throw new Error("Firebase token signature is invalid");
  }

  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = Number(claims.exp);
  const issuedAt = Number(claims.iat);
  const subject = requiredStringClaim(claims, "sub");
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Firebase token has expired");
  if (!Number.isFinite(issuedAt) || issuedAt > now + 300) throw new Error("Firebase token issued-at claim is invalid");
  if (claims.aud !== projectId) throw new Error("Firebase token audience is invalid");
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Firebase token issuer is invalid");
  if (subject.length > 256) throw new Error("Firebase token subject is invalid");
  return claims;
}
