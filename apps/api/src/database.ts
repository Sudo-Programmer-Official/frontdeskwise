import { Pool, type PoolConfig } from "pg";
import { readFileSync } from "node:fs";

const DEFAULT_DATABASE_NAME = "frontdeskwise";
const VALID_SSL_MODES = new Set(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]);
const SSL_MODE_ALIASES: Record<string, string> = {
  required: "require",
  enabled: "require",
  true: "require",
  "1": "require",
  on: "require",
  disabled: "disable",
  false: "disable",
  "0": "disable",
  off: "disable",
};

export type DatabaseConfig = {
  connectionString: string;
  databaseName: string;
  ssl: false | { rejectUnauthorized: boolean; ca?: string } | undefined;
};

function normalizeSslMode(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (VALID_SSL_MODES.has(normalized)) return normalized;
  return SSL_MODE_ALIASES[normalized];
}

function envBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("DATABASE_SSL_REJECT_UNAUTHORIZED must be a boolean");
}

function sslCertificateFromEnv(): string | undefined {
  const filePath = process.env.DATABASE_SSL_CA_FILE?.trim();
  if (filePath) {
    try {
      const certificate = readFileSync(filePath, "utf8").trim();
      if (!certificate || !certificate.includes("BEGIN CERTIFICATE")) throw new Error("invalid certificate");
      return certificate;
    } catch (error) {
      if (error instanceof Error && error.message === "invalid certificate") throw error;
      throw new Error(`DATABASE_SSL_CA_FILE could not be read: ${filePath}`);
    }
  }

  const pem = process.env.DATABASE_SSL_CA?.trim();
  if (pem) return pem;

  const encoded = process.env.DATABASE_SSL_CA_BASE64?.trim();
  if (!encoded) return undefined;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    if (!decoded || !decoded.includes("BEGIN CERTIFICATE")) throw new Error("invalid certificate");
    return decoded;
  } catch {
    throw new Error("DATABASE_SSL_CA_BASE64 must contain a base64-encoded PEM certificate");
  }
}

function expectedDatabaseName(): string {
  return process.env.FRONTDESKWISE_DATABASE_NAME?.trim() || DEFAULT_DATABASE_NAME;
}

export function parseDatabaseConfig(rawValue: string): DatabaseConfig {
  const raw = rawValue.trim();
  if (!raw) throw new Error("DATABASE_URL cannot be empty");

  const urlValue = raw.replace(/^postgresql\+asyncpg:/i, "postgresql:");
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql scheme");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const expectedName = expectedDatabaseName();
  if (databaseName !== expectedName) {
    throw new Error(`DATABASE_URL must target the separate ${expectedName} database`);
  }

  const sslMode = normalizeSslMode(url.searchParams.get("sslmode"));
  const legacySsl = url.searchParams.get("ssl");
  const normalizedLegacySsl = legacySsl ? normalizeSslMode(legacySsl) : undefined;
  const requestedSslMode = sslMode ?? normalizedLegacySsl;
  if ((url.searchParams.has("sslmode") || legacySsl) && !requestedSslMode) {
    throw new Error("DATABASE_URL contains an unsupported SSL mode");
  }

  const rejectUnauthorizedOverride = envBoolean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED);
  const ca = sslCertificateFromEnv();
  let ssl: DatabaseConfig["ssl"];
  if (!requestedSslMode || requestedSslMode === "disable") {
    ssl = requestedSslMode === "disable" ? false : undefined;
  } else {
    ssl = {
      // RDS URLs commonly use sslmode=require without a local CA bundle. This
      // still encrypts the connection; verify-ca/full can opt into certificate validation.
      rejectUnauthorized: rejectUnauthorizedOverride ?? ["verify-ca", "verify-full"].includes(requestedSslMode),
      ...(ca ? { ca } : {}),
    };
  }

  // Pass SSL explicitly to node-postgres. Keeping sslmode/ssl out of the URL
  // prevents pg's connection-string parser from silently replacing this object.
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  url.searchParams.delete("uselibpqcompat");

  return { connectionString: url.toString(), databaseName, ssl };
}

export function databaseConfigFromEnv(required = false): DatabaseConfig | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    if (required) throw new Error("DATABASE_URL is required");
    return null;
  }
  return parseDatabaseConfig(raw);
}

export function createPoolFromEnv(options: Omit<PoolConfig, "connectionString" | "ssl"> = {}): Pool | null {
  const config = databaseConfigFromEnv();
  if (!config) return null;
  return new Pool({ ...options, connectionString: config.connectionString, ssl: config.ssl });
}

export function safeDatabaseTarget(rawValue: string): string {
  const config = parseDatabaseConfig(rawValue);
  const url = new URL(config.connectionString);
  return `${url.protocol}//${url.hostname}:${url.port || "5432"}/${config.databaseName}`;
}
