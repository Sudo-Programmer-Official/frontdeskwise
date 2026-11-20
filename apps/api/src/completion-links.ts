import type { CompletionLinkTemplate } from "./action-flows.js";

export type CompletionLinkResult = {
  url: string;
  mappedFields: string[];
  missingFields: string[];
};

function valueAt(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path];
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) return (current as Record<string, unknown>)[part];
    return undefined;
  }, values);
}

function safeBaseUrl(value: string): URL {
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("Completion links must use HTTPS");
  }
  return url;
}

/**
 * Turns an integration-owned URL template into a provider completion link.
 * Only explicitly mapped, non-empty values are copied into the URL. This
 * keeps sensitive fields out of links unless the owner deliberately maps them.
 */
export function generateCompletionLink(template: CompletionLinkTemplate, values: Record<string, unknown>): CompletionLinkResult {
  const url = safeBaseUrl(template.baseUrl);
  const mappedFields: string[] = [];
  const missingFields: string[] = [];
  for (const [sourcePath, targetParam] of Object.entries(template.fieldMappings)) {
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(targetParam)) continue;
    const raw = valueAt(values, sourcePath);
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      missingFields.push(sourcePath);
      continue;
    }
    url.searchParams.set(targetParam, String(raw).trim());
    mappedFields.push(sourcePath);
  }
  for (const [key, value] of Object.entries(template.staticParams ?? {})) {
    if (/^[A-Za-z0-9_.-]{1,120}$/.test(key) && typeof value === "string") url.searchParams.set(key, value);
  }
  return { url: url.toString(), mappedFields, missingFields };
}

