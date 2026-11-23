/**
 * Structured, lifecycle-aware business actions.
 *
 * Knowledge chunks explain a business. Action resources describe a safe next
 * step. Keeping this model independent from ActionFlow makes it possible to
 * use the same resolver for registrations, bookings, jobs, payments, and
 * manually maintained forms.
 */

export const ACTION_RESOURCE_TYPES = [
  "registration",
  "booking",
  "job_application",
  "payment",
  "application",
  "quote",
  "contact",
  "custom",
] as const;

export type ActionResourceType = typeof ACTION_RESOURCE_TYPES[number];

export const ACTION_RESOURCE_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "EXPIRED",
  "FULL",
  "WAITLIST",
  "DRAFT",
  "ERROR",
] as const;

export type ActionResourceStatus = typeof ACTION_RESOURCE_STATUSES[number];
export type ActionResourceProvider = "manual" | "jackrabbit" | "square" | "mindbody" | "calendly" | "greenhouse" | "lever" | "hubspot" | "custom";

export type ActionResourceCondition = {
  field: string;
  equals?: string;
  contains?: string;
  in?: string[];
  notEquals?: string;
};

export type ActionResourceDestination = {
  url: string;
  label?: string;
};

export type ActionResource = {
  id: string;
  businessId: string;
  type: ActionResourceType;
  name: string;
  provider: ActionResourceProvider;
  providerObjectId: string | null;
  location: string | null;
  program: string | null;
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  department: string | null;
  service: string | null;
  price: string | number | null;
  availability: number | null;
  metadata: Record<string, unknown>;
  conditions: ActionResourceCondition[];
  destination: ActionResourceDestination | null;
  status: ActionResourceStatus;
  validFrom: string | null;
  validUntil: string | null;
  source: string;
  lastSyncedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ActionResourceInput = Partial<Omit<ActionResource, "id" | "createdAt" | "updatedAt">> & {
  id?: string;
  businessId: string;
  type: ActionResourceType;
  name: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ActionQuery = {
  type: ActionResourceType;
  filters?: Record<string, unknown>;
  includeWaitlist?: boolean;
  now?: string | Date;
};

export type SafeActionResult = {
  id: string;
  type: ActionResourceType;
  name: string;
  provider: ActionResourceProvider;
  providerObjectId: string | null;
  location: string | null;
  program: string | null;
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  role: string | null;
  department: string | null;
  service: string | null;
  price: string | number | null;
  availability: number | null;
  destination: ActionResourceDestination | null;
  status: ActionResourceStatus;
  metadata: Record<string, unknown>;
};

export type ActionResolution = {
  status: "matched" | "ambiguous" | "not_found" | "unavailable";
  matches: SafeActionResult[];
};

const FIELD_NAMES = new Set([
  "name", "location", "program", "day", "startTime", "endTime", "role", "department", "service",
  "price", "availability", "providerObjectId", "status", "provider", "type",
]);

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function valueAt(resource: ActionResource, field: string): unknown {
  if (field in resource) return resource[field as keyof ActionResource];
  if (field in resource.metadata) return resource.metadata[field];
  const path = field.split(".");
  let current: unknown = resource.metadata;
  for (const part of path) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function safeUrl(value: string): string {
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("Action resource destinations must use HTTPS");
  }
  return url.toString();
}

function resourceType(value: unknown): ActionResourceType {
  if (typeof value === "string" && (ACTION_RESOURCE_TYPES as readonly string[]).includes(value)) return value as ActionResourceType;
  throw new Error("Unsupported action resource type");
}

function resourceStatus(value: unknown): ActionResourceStatus {
  if (typeof value === "string" && (ACTION_RESOURCE_STATUSES as readonly string[]).includes(value.toUpperCase())) return value.toUpperCase() as ActionResourceStatus;
  return "ACTIVE";
}

function provider(value: unknown): ActionResourceProvider {
  const allowed: readonly string[] = ["manual", "jackrabbit", "square", "mindbody", "calendly", "greenhouse", "lever", "hubspot", "custom"];
  if (value === undefined || value === null || value === "") return "manual";
  if (typeof value === "string" && allowed.includes(value.toLowerCase())) return value.toLowerCase() as ActionResourceProvider;
  throw new Error("Unsupported action resource provider");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function cleanMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key) || /(token|secret|password|credential|authorization)/i.test(key)) continue;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") result[key] = item;
    else if (Array.isArray(item)) result[key] = item.filter((entry) => ["string", "number", "boolean"].includes(typeof entry)).slice(0, 50);
  }
  return result;
}

function cleanConditions(value: unknown): ActionResourceCondition[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ActionResourceCondition | null => {
    if (!item || typeof item !== "object") return null;
    const source = item as Record<string, unknown>;
    const field = stringOrNull(source.field);
    if (!field || !/^[a-zA-Z0-9_.-]{1,120}$/.test(field)) return null;
    const values = Array.isArray(source.in) ? source.in.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 50) : undefined;
    return {
      field,
      ...(stringOrNull(source.equals) ? { equals: stringOrNull(source.equals) as string } : {}),
      ...(stringOrNull(source.contains) ? { contains: stringOrNull(source.contains) as string } : {}),
      ...(values?.length ? { in: values } : {}),
      ...(stringOrNull(source.notEquals) ? { notEquals: stringOrNull(source.notEquals) as string } : {}),
    };
  }).filter((item): item is ActionResourceCondition => Boolean(item)).slice(0, 50);
}

function normalizeDestination(value: unknown): ActionResourceDestination | null {
  if (typeof value === "string" && value.trim()) return { url: safeUrl(value.trim()) };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const url = stringOrNull(source.url);
  if (!url) return null;
  return {
    url: safeUrl(url),
    ...(stringOrNull(source.label) ? { label: stringOrNull(source.label) as string } : {}),
  };
}

/** Normalize and validate an owner-authored or provider-synced resource. */
export function normalizeActionResource(input: ActionResourceInput, now = new Date().toISOString()): ActionResource {
  const createdAt = stringOrNull(input.createdAt) ?? now;
  const updatedAt = stringOrNull(input.updatedAt) ?? now;
  const validFrom = stringOrNull(input.validFrom);
  const validUntil = stringOrNull(input.validUntil);
  if (validFrom && !safeDate(validFrom)) throw new Error("Action resource validFrom must be an ISO date");
  if (validUntil && !safeDate(validUntil)) throw new Error("Action resource validUntil must be an ISO date");
  if (validFrom && validUntil && (safeDate(validFrom)!.getTime() > safeDate(validUntil)!.getTime())) throw new Error("Action resource validFrom must be before validUntil");
  const name = input.name.trim();
  if (!name) throw new Error("Action resource name is required");
  return {
    id: stringOrNull(input.id) ?? "",
    businessId: input.businessId,
    type: resourceType(input.type),
    name: name.slice(0, 240),
    provider: provider(input.provider),
    providerObjectId: stringOrNull(input.providerObjectId),
    location: stringOrNull(input.location),
    program: stringOrNull(input.program),
    day: stringOrNull(input.day),
    startTime: stringOrNull(input.startTime),
    endTime: stringOrNull(input.endTime),
    role: stringOrNull(input.role),
    department: stringOrNull(input.department),
    service: stringOrNull(input.service),
    price: typeof input.price === "number" || typeof input.price === "string" ? input.price : null,
    availability: numericOrNull(input.availability),
    metadata: cleanMetadata(input.metadata),
    conditions: cleanConditions(input.conditions),
    destination: normalizeDestination(input.destination),
    status: resourceStatus(input.status),
    validFrom,
    validUntil,
    source: stringOrNull(input.source) ?? (provider(input.provider) === "manual" ? "manual" : provider(input.provider)),
    lastSyncedAt: stringOrNull(input.lastSyncedAt),
    version: Math.max(1, Math.floor(numericOrNull(input.version) ?? 1)),
    createdAt,
    updatedAt,
  };
}

export function actionResourceStatus(resource: ActionResource, now: string | Date = new Date()): ActionResourceStatus {
  const current = safeDate(now)?.getTime() ?? Date.now();
  const validFrom = safeDate(resource.validFrom)?.getTime();
  const validUntil = safeDate(resource.validUntil)?.getTime();
  if (validFrom !== undefined && validFrom !== null && current < validFrom) return "DRAFT";
  if (validUntil !== undefined && validUntil !== null && current > validUntil) return "EXPIRED";
  return resource.status;
}

function matchValue(actual: unknown, expected: unknown, field: string): boolean {
  const left = normalized(actual);
  const right = normalized(expected);
  if (!left || !right) return false;
  if (field === "name" || field === "role" || field === "department" || field === "service") return left === right || left.includes(right) || right.includes(left);
  return left === right || left.includes(right);
}

function conditionMatches(resource: ActionResource, condition: ActionResourceCondition): boolean {
  const actual = valueAt(resource, condition.field);
  const value = normalized(actual);
  if (condition.equals !== undefined && value !== normalized(condition.equals)) return false;
  if (condition.notEquals !== undefined && value === normalized(condition.notEquals)) return false;
  if (condition.contains !== undefined && !value.includes(normalized(condition.contains))) return false;
  if (condition.in?.length && !condition.in.some((item) => value === normalized(item))) return false;
  return true;
}

function queryFiltersMatch(resource: ActionResource, filters: Record<string, unknown>): { matches: boolean; score: number } {
  let score = 0;
  for (const [field, expected] of Object.entries(filters)) {
    if (expected === undefined || expected === null || String(expected).trim() === "") continue;
    if (!FIELD_NAMES.has(field) && valueAt(resource, field) === undefined) return { matches: false, score: 0 };
    const actual = valueAt(resource, field);
    if (!matchValue(actual, expected, field)) return { matches: false, score: 0 };
    score += normalized(actual) === normalized(expected) ? 3 : 1;
  }
  return { matches: true, score };
}

export function safeActionResult(resource: ActionResource): SafeActionResult {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    provider: resource.provider,
    providerObjectId: resource.providerObjectId,
    location: resource.location,
    program: resource.program,
    day: resource.day,
    startTime: resource.startTime,
    endTime: resource.endTime,
    role: resource.role,
    department: resource.department,
    service: resource.service,
    price: resource.price,
    availability: resource.availability,
    destination: resource.destination,
    status: resource.status,
    metadata: cleanMetadata(resource.metadata),
  };
}

/**
 * Resolve only currently usable resources. A resolver returns every equally
 * valid option so presentation can show choices instead of guessing a link.
 */
export function resolveAction(resources: ActionResource[], query: ActionQuery): ActionResolution {
  const now = query.now ?? new Date();
  const matches = resources
    .map((resource) => {
      const currentStatus = actionResourceStatus(resource, now);
      if (resource.type !== query.type) return null;
      if (!["ACTIVE", ...(query.includeWaitlist ? ["WAITLIST"] : [])].includes(currentStatus)) return null;
      if (!resource.destination?.url) return null;
      if (!resource.conditions.every((condition) => conditionMatches(resource, condition))) return null;
      const filterResult = queryFiltersMatch(resource, query.filters ?? {});
      if (!filterResult.matches) return null;
      return { resource: { ...resource, status: currentStatus }, score: filterResult.score };
    })
    .filter((item): item is { resource: ActionResource; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score || left.resource.name.localeCompare(right.resource.name) || left.resource.id.localeCompare(right.resource.id))
    .map((item) => safeActionResult(item.resource));
  return {
    status: matches.length === 0 ? "not_found" : matches.length === 1 ? "matched" : "ambiguous",
    matches,
  };
}

/** Convert a live Jackrabbit class/listing into a registry resource. */
export function actionResourceFromJackrabbit(input: {
  businessId: string;
  option: {
    id: string;
    name: string;
    location: string | null;
    days: string[];
    startTime: string | null;
    endTime: string | null;
    openings: number | null;
    waitlistAvailable: boolean | null;
    tuition: string | number | null;
    registrationUrl: string | null;
    raw?: Record<string, unknown>;
  };
  destinationUrl?: string | null;
  now?: string;
}): ActionResource {
  const { option } = input;
  const status: ActionResourceStatus = option.openings !== null && option.openings <= 0
    ? (option.waitlistAvailable ? "WAITLIST" : "FULL")
    : "ACTIVE";
  const destination = option.registrationUrl ?? input.destinationUrl ?? null;
  return normalizeActionResource({
    id: `jackrabbit:${option.id}`,
    businessId: input.businessId,
    type: "registration",
    name: option.name,
    provider: "jackrabbit",
    providerObjectId: option.id,
    location: option.location,
    program: option.name,
    day: option.days[0] ?? null,
    startTime: option.startTime,
    endTime: option.endTime,
    price: option.tuition,
    availability: option.openings,
    metadata: { ...(option.raw ?? {}), days: option.days },
    destination: destination ? { url: destination, label: "Continue registration" } : null,
    status,
    source: "jackrabbit",
    lastSyncedAt: input.now ?? new Date().toISOString(),
    version: 1,
  }, input.now ?? new Date().toISOString());
}
