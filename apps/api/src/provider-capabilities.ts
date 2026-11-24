import { assertPublicUrl } from "./crawler.js";

export type ProviderCapabilityType = "READ" | "WRITE";
export type ProviderCapabilityLifecycle = "discovered" | "approved" | "disabled";
export type ProviderAuthType = "none" | "bearer_token" | "api_key" | "basic" | "oauth2";
export type ProviderPiiClassification = "none" | "unknown" | "low" | "high" | "restricted";
export type ProviderHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type CustomerVerificationStatus = "UNKNOWN" | "VERIFIED" | "NOT_FOUND" | "AMBIGUOUS" | "PROVIDER_UNAVAILABLE";
export type ProviderFallbackBehavior = "retry_identity" | "capture_request" | "handoff" | "stop";
export type ProviderAuthorizationReason =
  | "capability_missing"
  | "capability_not_approved"
  | "provider_unavailable"
  | "tenant_mismatch"
  | "missing_fields"
  | "invalid_input"
  | "customer_not_verified"
  | "confirmation_required";
export type CustomerVerificationState = {
  status: CustomerVerificationStatus;
  provider?: string | null;
  capabilityKey?: string | null;
  providerObjectId?: string | null;
  reason?: string | null;
  updatedAt?: string;
};
export type ProviderOperationStatus = "succeeded" | "failed" | "blocked";
export type ProviderOperationHonesty = {
  canAnswer: boolean;
  canLookup: boolean;
  canPrepare: boolean;
  canSubmit: boolean;
  canConfirmSuccess: boolean;
};
export type ProviderOperationRecord = {
  provider: string;
  capabilityKey: string;
  type: ProviderCapabilityType;
  status: ProviderOperationStatus;
  verificationState: CustomerVerificationStatus;
  authorization: "allowed" | "blocked";
  authorizationReason?: ProviderAuthorizationReason | null;
  resultStatus?: string | null;
  fallbackBehavior?: ProviderFallbackBehavior | null;
  honesty?: ProviderOperationHonesty;
  latencyMs?: number | null;
  completedAt?: string;
};
export type JsonSchema = Record<string, unknown>;

export type ProviderCapability = {
  key: string;
  providerId: string;
  name: string;
  description: string | null;
  operationId: string | null;
  type: ProviderCapabilityType;
  method: ProviderHttpMethod;
  path: string;
  authScope: string | null;
  allowedMethods: ProviderHttpMethod[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  rateLimit: Record<string, unknown>;
  timeoutMs: number;
  retryPolicy: Record<string, unknown>;
  piiClassification: ProviderPiiClassification;
  requiresVerifiedCustomer: boolean;
  requiresConfirmation: boolean;
  /** Compatibility alias retained for existing persisted capability payloads. */
  confirmationRequired: boolean;
  fallbackBehavior: ProviderFallbackBehavior;
  lifecycleStatus: ProviderCapabilityLifecycle;
  enabled: boolean;
  metadata: Record<string, unknown>;
};

export type ProviderConnection = {
  id: string;
  businessId: string;
  providerKey: string;
  displayName: string;
  baseUrl: string;
  authType: ProviderAuthType;
  sourceType: "native" | "openapi" | "custom_rest";
  specUrl: string | null;
  status: "pending" | "active" | "error" | "disabled";
};

export type ProviderCredential = {
  type: ProviderAuthType;
  token?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  username?: string;
  password?: string;
};

export type ProviderAuthorizationInput = {
  capability: ProviderCapability | null;
  providerConnected: boolean;
  tenantMatch: boolean;
  input: unknown;
  customerVerification?: CustomerVerificationState | null;
  confirmationReceived?: boolean;
};

export type ProviderAuthorizationDecision = {
  allowed: boolean;
  reason: ProviderAuthorizationReason | null;
  missingFields: string[];
};

export type OpenApiIngestionResult = {
  baseUrl: string | null;
  capabilities: ProviderCapability[];
  warnings: string[];
};

type JsonRecord = Record<string, unknown>;

const HTTP_METHODS = new Set<ProviderHttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const READ_METHODS = new Set<ProviderHttpMethod>(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const candidate = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function capabilityKey(value: string, method: ProviderHttpMethod, path: string): string {
  const camelCase = value.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  const normalized = camelCase.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const fallback = `${method.toLowerCase()}_${path}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const result = normalized || fallback || "capability";
  return /^[a-z]/.test(result) ? result : `capability_${result}`;
}

function operationName(operation: JsonRecord, method: ProviderHttpMethod, path: string): string {
  return nonEmptyString(operation.summary) ?? nonEmptyString(operation.operationId) ?? `${method} ${path}`;
}

function schemaObject(value: unknown): JsonSchema {
  const record = asRecord(value);
  return Object.keys(record).length ? record : { type: "object" };
}

function parameterSchema(parameter: JsonRecord): JsonSchema {
  const schema = parameter.schema;
  if (schema && typeof schema === "object" && !Array.isArray(schema)) return schemaObject(schema);
  const type = nonEmptyString(asRecord(parameter).type) ?? "string";
  return { type };
}

function responseSchema(operation: JsonRecord): JsonSchema {
  const responses = asRecord(operation.responses);
  const response = Object.entries(responses)
    .filter(([status]) => /^2\d\d$|^default$/i.test(status))
    .sort(([left], [right]) => left === "default" ? 1 : right === "default" ? -1 : left.localeCompare(right))[0]?.[1];
  const responseRecord = asRecord(response);
  const content = asRecord(responseRecord.content);
  const media = content["application/json"] ?? Object.values(content)[0];
  const mediaRecord = asRecord(media);
  return schemaObject(mediaRecord.schema ?? responseRecord.schema ?? { type: "object" });
}

function requestBodySchema(operation: JsonRecord): JsonSchema | null {
  const requestBody = asRecord(operation.requestBody);
  const content = asRecord(requestBody.content);
  const media = content["application/json"] ?? Object.values(content)[0];
  const mediaRecord = asRecord(media);
  return Object.keys(mediaRecord).length || requestBody.schema ? schemaObject(mediaRecord.schema ?? requestBody.schema) : null;
}

function piiClassification(properties: JsonRecord): ProviderPiiClassification {
  const names = Object.keys(properties).join(" ").toLowerCase();
  if (/password|secret|token|ssn|social_security|health|medical|diagnosis|payment|card_number|cvv/.test(names)) return "restricted";
  if (/email|phone|mobile|address|name|child|guardian|parent|birth|dob/.test(names)) return "high";
  if (!names.trim()) return "unknown";
  return "none";
}

function securityScope(document: JsonRecord, operation: JsonRecord): string | null {
  const security = Array.isArray(operation.security) ? operation.security : Array.isArray(document.security) ? document.security : [];
  const first = asRecord(security[0]);
  const scheme = Object.keys(first)[0];
  if (!scheme) return null;
  const schemes = asRecord(asRecord(document.components).securitySchemes);
  const definition = asRecord(schemes[scheme]);
  const scopes = stringList(first[scheme]);
  return scopes.length ? scopes.join(" ") : nonEmptyString(definition.description) ?? scheme;
}

function serverBaseUrl(document: JsonRecord): string | null {
  const server = asRecord(Array.isArray(document.servers) ? document.servers[0] : null);
  if (nonEmptyString(server.url)) return nonEmptyString(server.url);
  const host = nonEmptyString(document.host);
  if (!host) return null;
  const scheme = nonEmptyString(Array.isArray(document.schemes) ? document.schemes[0] : null) ?? "https";
  return `${scheme}://${host}${nonEmptyString(document.basePath) ?? ""}`;
}

function extensionConfig(operation: JsonRecord, document: JsonRecord): JsonRecord {
  const operationExtension = asRecord(operation["x-frontdeskwise"]);
  const documentExtension = asRecord(document["x-frontdeskwise"]);
  return { ...documentExtension, ...operationExtension };
}

function fallbackBehavior(value: unknown, customerLookup = false): ProviderFallbackBehavior {
  const candidate = nonEmptyString(value);
  if (candidate === "retry_identity" || candidate === "capture_request" || candidate === "handoff" || candidate === "stop") return candidate;
  return customerLookup ? "retry_identity" : "capture_request";
}

function isCustomerLookupKey(value: string): boolean {
  return /(?:^|_)(?:lookup|find|get|search)_(?:customer|account|member|student)|(?:customer|account|member|student)_(?:lookup|search|details?)/i.test(value);
}

function extensionBoolean(extension: JsonRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof extension[key] === "boolean") return extension[key] as boolean;
  }
  return undefined;
}

function addProperty(schema: JsonSchema, name: string, value: JsonSchema, required: boolean): void {
  const properties = asRecord(schema.properties);
  properties[name] = value;
  schema.properties = properties;
  if (required) {
    const requiredValues = stringList(schema.required);
    if (!requiredValues.includes(name)) schema.required = [...requiredValues, name];
  }
}

function capabilityFromOperation(
  providerId: string,
  path: string,
  method: ProviderHttpMethod,
  operation: JsonRecord,
  inheritedParameters: unknown[],
  document: JsonRecord,
  usedKeys: Set<string>,
): ProviderCapability {
  const extension = extensionConfig(operation, document);
  const type = READ_METHODS.has(method) ? "READ" : "WRITE";
  const operationId = nonEmptyString(operation.operationId);
  const baseKey = capabilityKey(nonEmptyString(extension.key) ?? operationId ?? "", method, path);
  let key = baseKey;
  let duplicate = 2;
  while (usedKeys.has(key)) key = `${baseKey}_${duplicate++}`;
  usedKeys.add(key);

  const inputSchema: JsonSchema = { type: "object", properties: {}, required: [] };
  const parameterLocations: Record<string, string> = {};
  const allParameters = [...inheritedParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
  for (const rawParameter of allParameters) {
    const parameter = asRecord(rawParameter);
    const name = nonEmptyString(parameter.name);
    const location = nonEmptyString(parameter.in);
    if (!name || !location || location === "cookie") continue;
    addProperty(inputSchema, name, parameterSchema(parameter), parameter.required === true || location === "path");
    parameterLocations[name] = location;
  }

  const bodySchema = requestBodySchema(operation);
  if (bodySchema) {
    const bodyProperties = asRecord(bodySchema.properties);
    if (Object.keys(bodyProperties).length) {
      for (const [name, schema] of Object.entries(bodyProperties)) {
        addProperty(inputSchema, name, schemaObject(schema), stringList(bodySchema.required).includes(name));
        parameterLocations[name] = "body";
      }
    } else {
      addProperty(inputSchema, "body", bodySchema, true);
      parameterLocations.body = "body";
    }
  }

  const properties = asRecord(inputSchema.properties);
  const explicitPii = nonEmptyString(extension.piiClassification);
  const pii = explicitPii === "none" || explicitPii === "unknown" || explicitPii === "low" || explicitPii === "high" || explicitPii === "restricted"
    ? explicitPii
    : piiClassification(properties);
  const configuredType = nonEmptyString(extension.type)?.toUpperCase();
  const capabilityType: ProviderCapabilityType = configuredType === "READ" || configuredType === "WRITE" ? configuredType : type;
  const customerLookup = extensionBoolean(extension, "customerLookup", "updatesCustomerVerification") === true || isCustomerLookupKey(baseKey);
  const policyCapability = extensionBoolean(extension, "policyCapability", "containsPolicyData") === true;
  const requiresVerifiedCustomer = extensionBoolean(extension, "requiresVerifiedCustomer") ?? capabilityType === "WRITE";
  const requiresConfirmation = extensionBoolean(extension, "requiresConfirmation", "confirmationRequired") ?? capabilityType === "WRITE";
  const timeoutMs = safeInteger(extension.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
  const allowedMethods = Array.isArray(extension.allowedMethods)
    ? stringList(extension.allowedMethods).map((item) => item.toUpperCase()).filter((item): item is ProviderHttpMethod => HTTP_METHODS.has(item as ProviderHttpMethod))
    : [method];
  return {
    key,
    providerId,
    name: nonEmptyString(extension.name) ?? operationName(operation, method, path),
    description: nonEmptyString(extension.description) ?? nonEmptyString(operation.description),
    operationId,
    type: capabilityType,
    method,
    path,
    authScope: securityScope(document, operation),
    allowedMethods: [...new Set(allowedMethods.length ? allowedMethods : [method])],
    inputSchema: {
      ...inputSchema,
      "x-frontdeskwise": {
        parameterLocations,
        bodyContentType: "application/json",
      },
    },
    outputSchema: responseSchema(operation),
    rateLimit: asRecord(extension.rateLimit),
    timeoutMs,
    retryPolicy: asRecord(extension.retryPolicy),
    piiClassification: pii,
    requiresVerifiedCustomer,
    requiresConfirmation,
    confirmationRequired: requiresConfirmation,
    fallbackBehavior: fallbackBehavior(extension.fallbackBehavior, customerLookup),
    lifecycleStatus: "discovered",
    enabled: false,
    metadata: {
      tags: stringList(operation.tags),
      deprecated: operation.deprecated === true,
      source: "openapi",
      customerLookup,
      policyCapability,
      requiresVerifiedCustomer,
      requiresConfirmation,
    },
  };
}

export function ingestOpenApiDocument(providerId: string, document: unknown, baseUrlOverride?: string | null): OpenApiIngestionResult {
  const spec = asRecord(document);
  const version = nonEmptyString(spec.openapi) ?? nonEmptyString(spec.swagger);
  if (!version || !(version.startsWith("3.") || version === "2.0")) throw new Error("Only OpenAPI 3.x and Swagger 2.0 documents are supported");
  const paths = asRecord(spec.paths);
  if (!Object.keys(paths).length) throw new Error("The API document does not contain any paths");
  const baseUrl = baseUrlOverride?.trim() || serverBaseUrl(spec);
  const capabilities: ProviderCapability[] = [];
  const warnings: string[] = [];
  const usedKeys = new Set<string>();
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = asRecord(rawPathItem);
    const inheritedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const [rawMethod, rawOperation] of Object.entries(pathItem)) {
      const method = rawMethod.toUpperCase() as ProviderHttpMethod;
      if (!HTTP_METHODS.has(method)) continue;
      const operation = asRecord(rawOperation);
      if (!Object.keys(operation).length) {
        warnings.push(`Skipped ${method} ${path}: operation is empty`);
        continue;
      }
      capabilities.push(capabilityFromOperation(providerId, path, method, operation, inheritedParameters, spec, usedKeys));
    }
  }
  if (!capabilities.length) throw new Error("The API document does not contain supported HTTP operations");
  return { baseUrl: baseUrl ?? null, capabilities, warnings };
}

export function manualProviderCapability(providerId: string, input: {
  key: string;
  name?: string;
  description?: string;
  type?: ProviderCapabilityType;
  method: string;
  path: string;
  authScope?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  rateLimit?: Record<string, unknown>;
  timeoutMs?: number;
  retryPolicy?: Record<string, unknown>;
  piiClassification?: ProviderPiiClassification;
  requiresVerifiedCustomer?: boolean;
  requiresConfirmation?: boolean;
  fallbackBehavior?: ProviderFallbackBehavior;
  confirmationRequired?: boolean;
  policyCapability?: boolean;
}): ProviderCapability {
  const method = input.method.toUpperCase() as ProviderHttpMethod;
  if (!HTTP_METHODS.has(method)) throw new Error(`Unsupported provider capability method: ${input.method}`);
  if (!/^\/[A-Za-z0-9_./:{}?=&%~-]*$/.test(input.path)) throw new Error("Provider capability path must be an absolute API path");
  const key = capabilityKey(input.key, method, input.path);
  const type = input.type ?? (READ_METHODS.has(method) ? "READ" : "WRITE");
  const requiresConfirmation = input.requiresConfirmation ?? input.confirmationRequired ?? type === "WRITE";
  return {
    key,
    providerId,
    name: input.name?.trim() || key,
    description: input.description?.trim() || null,
    operationId: null,
    type,
    method,
    path: input.path,
    authScope: input.authScope?.trim() || null,
    allowedMethods: [method],
    inputSchema: schemaObject(input.inputSchema ?? { type: "object", properties: {} }),
    outputSchema: schemaObject(input.outputSchema ?? { type: "object" }),
    rateLimit: input.rateLimit ?? {},
    timeoutMs: safeInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS),
    retryPolicy: input.retryPolicy ?? {},
    piiClassification: input.piiClassification ?? "unknown",
    requiresVerifiedCustomer: input.requiresVerifiedCustomer ?? type === "WRITE",
    requiresConfirmation,
    confirmationRequired: requiresConfirmation,
    fallbackBehavior: input.fallbackBehavior ?? (isCustomerLookupKey(key) ? "retry_identity" : "capture_request"),
    lifecycleStatus: "discovered",
    enabled: false,
    metadata: {
      source: "custom_rest",
      customerLookup: isCustomerLookupKey(key),
      policyCapability: input.policyCapability === true,
      requiresVerifiedCustomer: input.requiresVerifiedCustomer ?? type === "WRITE",
      requiresConfirmation,
    },
  };
}

/** Native adapters use the same capability contract as imported REST APIs. */
export function nativeProviderCapability(providerId: string, input: Parameters<typeof manualProviderCapability>[1]): ProviderCapability {
  const capability = manualProviderCapability(providerId, input);
  return {
    ...capability,
    lifecycleStatus: "approved",
    enabled: true,
    metadata: { ...capability.metadata, source: "native" },
  };
}

export function isCustomerLookupCapability(capability: ProviderCapability): boolean {
  return asRecord(capability.metadata).customerLookup === true || isCustomerLookupKey(capability.key);
}

export function customerVerificationFromResult(
  capability: ProviderCapability,
  result: { status?: string | null; matches?: unknown[]; providerObjectId?: string | null },
  now = new Date().toISOString(),
): CustomerVerificationState | null {
  if (!isCustomerLookupCapability(capability)) return null;
  const status = result.status === "unavailable"
    ? "PROVIDER_UNAVAILABLE"
    : result.status === "ambiguous"
      ? "AMBIGUOUS"
      : Array.isArray(result.matches) && result.matches.length === 1
        ? "VERIFIED"
        : Array.isArray(result.matches) && result.matches.length > 1
          ? "AMBIGUOUS"
          : result.status === "matched" || result.providerObjectId
            ? "VERIFIED"
            : "NOT_FOUND";
  const first = Array.isArray(result.matches) && result.matches.length === 1 && result.matches[0] && typeof result.matches[0] === "object"
    ? result.matches[0] as JsonRecord
    : null;
  const providerObjectId = result.providerObjectId
    ?? (first ? String(first.providerObjectId ?? first.id ?? "") || null : null);
  return {
    status,
    provider: capability.providerId,
    capabilityKey: capability.key,
    providerObjectId,
    reason: status === "NOT_FOUND" ? "provider_customer_not_found" : status === "AMBIGUOUS" ? "provider_customer_ambiguous" : status === "PROVIDER_UNAVAILABLE" ? "provider_lookup_unavailable" : null,
    updatedAt: now,
  };
}

export function authorizeProviderCapability(input: ProviderAuthorizationInput): ProviderAuthorizationDecision {
  const capability = input.capability;
  if (!capability) return { allowed: false, reason: "capability_missing", missingFields: [] };
  if (!capability.enabled || capability.lifecycleStatus !== "approved") return { allowed: false, reason: "capability_not_approved", missingFields: [] };
  if (!input.tenantMatch) return { allowed: false, reason: "tenant_mismatch", missingFields: [] };
  if (!input.providerConnected) return { allowed: false, reason: "provider_unavailable", missingFields: [] };
  const missingFields = providerCapabilityInputErrors(capability.inputSchema, input.input);
  if (missingFields.length) return { allowed: false, reason: "missing_fields", missingFields };
  if (capability.requiresVerifiedCustomer && input.customerVerification?.status !== "VERIFIED") {
    return { allowed: false, reason: "customer_not_verified", missingFields: [] };
  }
  if (capability.requiresConfirmation && input.confirmationReceived !== true) {
    return { allowed: false, reason: "confirmation_required", missingFields: [] };
  }
  return { allowed: true, reason: null, missingFields: [] };
}

export function providerCapabilityInputErrors(schema: JsonSchema, input: unknown): string[] {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as JsonRecord : {};
  const errors: string[] = [];
  for (const required of stringList(schema.required)) {
    if (value[required] === undefined || value[required] === null || value[required] === "") errors.push(required);
  }
  const properties = asRecord(schema.properties);
  for (const [name, rawSchema] of Object.entries(properties)) {
    const current = value[name];
    if (current === undefined || current === null) continue;
    const type = nonEmptyString(asRecord(rawSchema).type);
    const valid = type === null
      || type === "string" && typeof current === "string"
      || type === "number" && typeof current === "number"
      || type === "integer" && typeof current === "number" && Number.isInteger(current)
      || type === "boolean" && typeof current === "boolean"
      || type === "array" && Array.isArray(current)
      || type === "object" && typeof current === "object" && !Array.isArray(current);
    if (!valid) errors.push(`${name} (expected ${type})`);
  }
  return errors;
}

/**
 * Keep customer-facing language honest about what a provider call actually
 * established. A blocked or failed write never becomes a claim of success.
 */
export function providerOperationHonesty(operation: Pick<ProviderOperationRecord, "type" | "status" | "authorization" | "resultStatus">): ProviderOperationHonesty {
  const succeeded = operation.status === "succeeded" && operation.authorization === "allowed";
  const canLookup = succeeded && operation.type === "READ";
  const canSubmit = succeeded && operation.type === "WRITE";
  const canConfirmSuccess = canSubmit && operation.resultStatus === "succeeded";
  const canAnswer = canLookup
    ? operation.resultStatus === "matched" || operation.resultStatus === "succeeded"
    : canConfirmSuccess;
  return {
    canAnswer,
    canLookup,
    canPrepare: succeeded,
    canSubmit,
    canConfirmSuccess,
  };
}

function schemaValidationError(schema: JsonSchema, value: unknown, path = "output"): string | null {
  if (schema.$ref) return null;
  const type = nonEmptyString(schema.type);
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const record = value as JsonRecord;
    for (const required of stringList(schema.required)) {
      if (record[required] === undefined || record[required] === null) return `${path}.${required} is required`;
    }
    for (const [name, child] of Object.entries(asRecord(schema.properties))) {
      if (record[name] !== undefined) {
        const error = schemaValidationError(schemaObject(child), record[name], `${path}.${name}`);
        if (error) return error;
      }
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    const itemSchema = asRecord(schema.items);
    for (let index = 0; index < value.length; index += 1) {
      const error = schemaValidationError(itemSchema, value[index], `${path}[${index}]`);
      if (error) return error;
    }
  } else if (type === "string" && typeof value !== "string") return `${path} must be a string`;
  else if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return `${path} must be a number`;
  else if (type === "integer" && (typeof value !== "number" || !Number.isInteger(value))) return `${path} must be an integer`;
  else if (type === "boolean" && typeof value !== "boolean") return `${path} must be a boolean`;
  return null;
}

function requestUrl(baseUrl: string, path: string, input: JsonRecord, locations: Record<string, string>): URL {
  const resolvedPath = path.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(String(input[name] ?? "")));
  if (resolvedPath.includes("{")) throw new Error("Provider capability input is missing a path parameter");
  const base = new URL(baseUrl);
  const url = new URL(resolvedPath, base);
  if (url.origin !== base.origin) throw new Error("Provider capability path must stay on the connected API host");
  for (const [name, location] of Object.entries(locations)) {
    if (location === "query" && input[name] !== undefined && input[name] !== null) url.searchParams.set(name, String(input[name]));
  }
  return url;
}

export async function executeProviderCapability(
  capability: ProviderCapability,
  connection: Pick<ProviderConnection, "baseUrl" | "status">,
  credential: ProviderCredential,
  input: Record<string, unknown>,
  options: { fetcher?: typeof fetch; timeoutMs?: number; urlValidator?: (value: string) => Promise<URL> } = {},
): Promise<unknown> {
  if (!capability.enabled || capability.lifecycleStatus !== "approved") throw new Error("Provider capability is not approved");
  if (connection.status !== "active") throw new Error("Provider connection is not active");
  const errors = providerCapabilityInputErrors(capability.inputSchema, input);
  if (errors.length) throw new Error(`Provider capability input is missing: ${errors.join(", ")}`);
  const extension = asRecord(capability.inputSchema["x-frontdeskwise"]);
  const locations = asRecord(extension.parameterLocations) as Record<string, string>;
  const url = await (options.urlValidator ?? assertPublicUrl)(requestUrl(connection.baseUrl, capability.path, input, locations).toString());
  const headers = new Headers({ accept: "application/json", "user-agent": "FrontDeskWise-ProviderCapability/1.0" });
  if (credential.type === "bearer_token" || credential.type === "oauth2") {
    if (!credential.token?.trim()) throw new Error("Provider bearer credential is not configured");
    headers.set("authorization", `Bearer ${credential.token.trim()}`);
  } else if (credential.type === "api_key") {
    if (!credential.apiKey?.trim()) throw new Error("Provider API key is not configured");
    headers.set(credential.apiKeyHeader?.trim() || "x-api-key", credential.apiKey.trim());
  } else if (credential.type === "basic") {
    if (!credential.username || !credential.password) throw new Error("Provider basic credentials are not configured");
    headers.set("authorization", `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`);
  }
  for (const [name, location] of Object.entries(locations)) {
    if (location === "header" && input[name] !== undefined && input[name] !== null) headers.set(name, String(input[name]));
  }

  const bodyFields = Object.entries(locations).filter(([, location]) => location === "body").map(([name]) => name);
  let body: string | undefined;
  if (bodyFields.length) {
    const payload = bodyFields.length === 1 && bodyFields[0] === "body" ? input.body : Object.fromEntries(bodyFields.map((name) => [name, input[name]]));
    body = JSON.stringify(payload);
    headers.set("content-type", "application/json");
  }
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, options.timeoutMs ?? capability.timeoutMs));
  const retryCount = capability.type === "READ" ? safeInteger(asRecord(capability.retryPolicy).maxAttempts, 1, 1, 3) : 1;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: capability.method, headers, body, signal: controller.signal, redirect: "error" });
      if (!response.ok) {
        const message = `Provider capability request failed (${response.status})`;
        if (capability.type === "READ" && (response.status === 429 || response.status >= 500) && attempt + 1 < retryCount) {
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text.trim()) return null;
      const contentType = response.headers.get("content-type") ?? "";
      const result = contentType.includes("json") ? JSON.parse(text) as unknown : text;
      const validationError = schemaValidationError(capability.outputSchema, result);
      if (validationError) throw new Error(`Provider capability response failed schema validation: ${validationError}`);
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") lastError = new Error("Provider capability request timed out");
      else lastError = error instanceof Error ? error : new Error("Provider capability request failed");
      if (capability.type !== "READ" || attempt + 1 >= retryCount) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Provider capability request failed");
}
