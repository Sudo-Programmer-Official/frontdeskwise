import type { CompletionLinkTemplate } from "./action-flows.js";
import { generateCompletionLink, type CompletionLinkResult } from "./completion-links.js";

export type JackrabbitProviderOptions = {
  accessToken: string;
  baseUrl?: string;
  apiVersion?: "v1" | "v0";
  organizationId?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export type JackrabbitOrganization = {
  id: string | null;
  name: string | null;
  raw: Record<string, unknown>;
};

export type JackrabbitClassOption = {
  id: string;
  name: string;
  location: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  openings: number | null;
  waitlistCount: number | null;
  waitlistAvailable: boolean | null;
  tuition: string | number | null;
  registrationUrl: string | null;
  source: "classes" | "class_listings" | "merged";
  raw: Record<string, unknown>;
};

export type JackrabbitClassSearch = {
  name: string;
  location?: string;
  day?: string;
};

export type JackrabbitRegistrationLinkTemplate = CompletionLinkTemplate & {
  /** Query parameter receiving the selected Jackrabbit class id. */
  classIdParam?: string;
  /** FrontDeskWise value key used for the selected class id. */
  classIdField?: string;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = "https://sandbox-api.jackrabbitclass.com";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 1_000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function valueAt(record: JsonRecord, candidates: string[]): unknown {
  for (const candidate of candidates) {
    const wanted = normalizedKey(candidate);
    const match = Object.entries(record).find(([key]) => normalizedKey(key) === wanted);
    if (match) return match[1];
  }
  return undefined;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|open|available)$/i.test(value.trim())) return true;
    if (/^(false|no|closed|unavailable)$/i.test(value.trim())) return false;
  }
  return null;
}

function firstString(record: JsonRecord, candidates: string[]): string | null {
  return stringValue(valueAt(record, candidates));
}

function firstStringDeep(value: unknown, candidates: string[], depth = 0): string | null {
  const record = asRecord(value);
  const direct = firstString(record, candidates);
  if (direct) return direct;
  if (depth >= 3) return null;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      const found = firstStringDeep(nested, candidates, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function firstNumber(record: JsonRecord, candidates: string[]): number | null {
  return numberValue(valueAt(record, candidates));
}

function firstBoolean(record: JsonRecord, candidates: string[]): boolean | null {
  return booleanValue(valueAt(record, candidates));
}

function dayName(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return DAY_NAMES[value];
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const index = DAY_NAMES.findIndex((day) => normalized === day.toLowerCase() || normalized.startsWith(day.slice(0, 3).toLowerCase()));
  return index >= 0 ? DAY_NAMES[index] : null;
}

function collectDays(value: unknown): string[] {
  const days: string[] = [];
  const add = (candidate: unknown) => {
    const direct = dayName(candidate);
    if (direct) {
      days.push(direct);
      return;
    }
    if (typeof candidate === "string") {
      for (const part of candidate.split(/[,&/|]+/)) {
        const parsed = dayName(part);
        if (parsed) days.push(parsed);
      }
    } else if (Array.isArray(candidate)) {
      candidate.forEach(add);
    } else if (candidate && typeof candidate === "object") {
      const nested = asRecord(candidate);
      const nestedDay = valueAt(nested, ["day", "dayOfWeek", "weekday", "name"]);
      if (nestedDay !== undefined) add(nestedDay);
    }
  };
  add(value);
  return [...new Set(days)];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  for (const key of ["items", "data", "results", "records", "value", "classes", "classListings"]) {
    const value = valueAt(record, [key]);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nested = extractItems(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function extractTotalCount(payload: unknown): number | null {
  const record = asRecord(payload);
  const direct = firstNumber(record, ["totalCount", "total", "count"]);
  if (direct !== null) return direct;
  for (const key of ["data", "meta", "pagination", "pageInfo"]) {
    const value = valueAt(record, [key]);
    if (value && typeof value === "object") {
      const nested = extractTotalCount(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function recordId(record: JsonRecord, source: JackrabbitClassOption["source"]): string | null {
  return firstString(record, source === "class_listings"
    ? ["classId", "classID", "id", "listingId"]
    : ["id", "classId", "classID", "listingId"]);
}

function recordName(record: JsonRecord): string {
  return firstString(record, ["name", "className", "title", "programName"]) ?? "Unnamed class";
}

function nestedSchedule(record: JsonRecord): JsonRecord[] {
  const schedule = valueAt(record, ["schedule", "schedules", "classSchedule", "meetingTimes"]);
  if (!Array.isArray(schedule)) return [];
  return schedule.map(asRecord).filter((item) => Object.keys(item).length > 0);
}

function recordLocation(record: JsonRecord): string | null {
  const direct = firstString(record, ["locationName", "classLocationName", "location"]);
  if (direct) return direct;
  const location = valueAt(record, ["location"]);
  if (location && typeof location === "object") return firstString(asRecord(location), ["name", "locationName", "title"]);
  return null;
}

function recordDays(record: JsonRecord): string[] {
  const direct = collectDays(valueAt(record, ["days", "day", "dayOfWeek", "weekday", "classDays"]));
  if (direct.length) return direct;
  return [...new Set(nestedSchedule(record).flatMap((item) => collectDays(valueAt(item, ["day", "dayOfWeek", "weekday", "days"]))))];
}

function recordTime(record: JsonRecord, candidates: string[]): string | null {
  const direct = firstString(record, candidates);
  if (direct) return direct;
  for (const item of nestedSchedule(record)) {
    const nested = firstString(item, candidates);
    if (nested) return nested;
  }
  return null;
}

function normalizeClass(record: JsonRecord, source: JackrabbitClassOption["source"]): JackrabbitClassOption | null {
  const id = recordId(record, source);
  if (!id) return null;
  return {
    id,
    name: recordName(record),
    location: recordLocation(record),
    days: recordDays(record),
    startTime: recordTime(record, ["startTime", "start", "classStartTime"]),
    endTime: recordTime(record, ["endTime", "end", "classEndTime"]),
    openings: firstNumber(record, ["openings", "openSpaces", "availableSpots", "spacesAvailable", "spotsAvailable", "remaining"]),
    waitlistCount: firstNumber(record, ["waitlistCount", "waitlistSpots", "waitlistSize"]),
    waitlistAvailable: firstBoolean(record, ["waitlistAvailable", "allowWaitlist", "hasWaitlist"]),
    tuition: valueAt(record, ["tuition", "fee", "price", "monthlyTuition"]) as string | number | null ?? null,
    registrationUrl: firstString(record, ["registrationUrl", "onlineRegistrationUrl", "enrollmentUrl", "registrationLink", "link"]),
    source,
    raw: record,
  };
}

function mergeClassOptions(left: JackrabbitClassOption, right: JackrabbitClassOption): JackrabbitClassOption {
  return {
    ...left,
    name: right.name !== "Unnamed class" ? right.name : left.name,
    location: right.location ?? left.location,
    days: right.days.length ? right.days : left.days,
    startTime: right.startTime ?? left.startTime,
    endTime: right.endTime ?? left.endTime,
    openings: right.openings ?? left.openings,
    waitlistCount: right.waitlistCount ?? left.waitlistCount,
    waitlistAvailable: right.waitlistAvailable ?? left.waitlistAvailable,
    tuition: right.tuition ?? left.tuition,
    registrationUrl: right.registrationUrl ?? left.registrationUrl,
    source: left.source === right.source ? left.source : "merged",
    raw: { ...left.raw, ...right.raw },
  };
}

function sortClassOptions(left: JackrabbitClassOption, right: JackrabbitClassOption): number {
  const leftDay = left.days[0] ? DAY_NAMES.indexOf(left.days[0]) : 7;
  const rightDay = right.days[0] ? DAY_NAMES.indexOf(right.days[0]) : 7;
  if (leftDay !== rightDay) return leftDay - rightDay;
  return (left.startTime ?? "").localeCompare(right.startTime ?? "");
}

export class JackrabbitProvider {
  private readonly accessToken: string;
  private readonly baseUrl: URL;
  private readonly apiVersion: "v1" | "v0";
  private readonly organizationId?: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: JackrabbitProviderOptions) {
    if (!options.accessToken.trim()) throw new Error("Jackrabbit Customer API token is required");
    this.accessToken = options.accessToken.trim();
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    const localDevelopment = this.baseUrl.hostname === "localhost" || this.baseUrl.hostname === "127.0.0.1";
    if (this.baseUrl.protocol !== "https:" && !(localDevelopment && this.baseUrl.protocol === "http:")) {
      throw new Error("Jackrabbit API base URL must use HTTPS");
    }
    this.apiVersion = options.apiVersion ?? "v1";
    this.organizationId = options.organizationId?.trim() || undefined;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? 8_000));
  }

  private async get(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    const url = new URL(`${this.apiVersion}/${path.replace(/^\/+/, "")}`, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.accessToken}`,
          "user-agent": "FrontDeskWise-Jackrabbit/1.0",
          ...(this.organizationId ? { "x-org-id": this.organizationId } : {}),
        },
      });
      if (!response.ok) {
        const correlationId = response.headers.get("x-correlation-id");
        const traceId = response.headers.get("traceId") ?? response.headers.get("x-trace-id");
        const details = [correlationId ? `correlation ${correlationId}` : null, traceId ? `trace ${traceId}` : null].filter(Boolean).join(", ");
        throw new Error(`Jackrabbit API request failed (${response.status}${details ? `; ${details}` : ""})`);
      }
      if (response.status === 204) return null;
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Jackrabbit API request timed out");
      throw error instanceof Error ? error : new Error("Jackrabbit API request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listAll(path: string): Promise<JsonRecord[]> {
    const records: JsonRecord[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await this.get(path, { page, pageSize: DEFAULT_PAGE_SIZE });
      const items = extractItems(payload).map(asRecord).filter((item) => Object.keys(item).length > 0);
      records.push(...items);
      const totalCount = extractTotalCount(payload);
      if (!items.length || items.length < DEFAULT_PAGE_SIZE || (totalCount !== null && records.length >= totalCount)) break;
    }
    return records;
  }

  async verifyConnection(): Promise<JackrabbitOrganization> {
    const payload = await this.get("Options/me");
    const raw = asRecord(payload);
    return {
      id: firstStringDeep(payload, ["organizationId", "orgId", "id"]),
      name: firstStringDeep(payload, ["organizationName", "orgName", "name"]),
      raw,
    };
  }

  async listClasses(): Promise<JsonRecord[]> {
    return this.listAll("Classes");
  }

  async listClassListings(): Promise<JsonRecord[]> {
    return this.listAll("ClassListings");
  }

  async findClassOptions(search: JackrabbitClassSearch): Promise<JackrabbitClassOption[]> {
    if (!search.name.trim()) throw new Error("A class name is required");
    const [classes, listings] = await Promise.all([this.listClasses(), this.listClassListings()]);
    const byId = new Map<string, JackrabbitClassOption>();
    const add = (record: JsonRecord, source: JackrabbitClassOption["source"]) => {
      const option = normalizeClass(record, source);
      if (!option) return;
      const existing = byId.get(option.id);
      byId.set(option.id, existing ? mergeClassOptions(existing, option) : option);
    };
    classes.forEach((record) => add(record, "classes"));
    listings.forEach((record) => add(record, "class_listings"));

    const name = normalizeText(search.name);
    const location = search.location ? normalizeText(search.location) : null;
    const day = search.day ? dayName(search.day) : null;
    return [...byId.values()]
      .filter((option) => {
        const normalizedName = normalizeText(option.name);
        const nameMatches = normalizedName === name || normalizedName.includes(name);
        const locationMatches = !location || (option.location ? normalizeText(option.location).includes(location) : false);
        const dayMatches = !day || option.days.includes(day);
        return nameMatches && locationMatches && dayMatches;
      })
      .sort(sortClassOptions);
  }

  buildRegistrationLink(
    template: JackrabbitRegistrationLinkTemplate,
    option: Pick<JackrabbitClassOption, "id">,
    values: Record<string, unknown> = {},
  ): CompletionLinkResult {
    const classIdField = template.classIdField ?? "classId";
    const classIdParam = template.classIdParam ?? template.fieldMappings[classIdField] ?? "classId";
    return generateCompletionLink(
      {
        baseUrl: template.baseUrl,
        fieldMappings: { ...template.fieldMappings, [classIdField]: classIdParam },
        ...(template.staticParams ? { staticParams: template.staticParams } : {}),
      },
      { ...values, [classIdField]: option.id },
    );
  }
}

export function jackrabbitProviderFromEnv(env: NodeJS.ProcessEnv = process.env): JackrabbitProvider {
  const accessToken = env.FRONTDESKWISE_JACKRABBIT_API_TOKEN ?? env.JACKRABBIT_API_TOKEN;
  if (!accessToken?.trim()) {
    throw new Error("Set FRONTDESKWISE_JACKRABBIT_API_TOKEN locally before using the Jackrabbit connector");
  }
  return jackrabbitProviderForToken(accessToken, env);
}

export function jackrabbitProviderForToken(accessToken: string, env: NodeJS.ProcessEnv = process.env): JackrabbitProvider {
  return new JackrabbitProvider({
    accessToken,
    baseUrl: env.FRONTDESKWISE_JACKRABBIT_API_BASE_URL,
  });
}
