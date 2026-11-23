import mixpanel from "mixpanel-browser/src/loaders/loader-module-core";
import {
  MIXPANEL_EVENTS,
  sanitizeMixpanelProperties,
  type MixpanelContext,
  type MixpanelEvent,
} from "./mixpanel-schema";

export { MIXPANEL_EVENTS } from "./mixpanel-schema";
export type { MixpanelContext, MixpanelEvent } from "./mixpanel-schema";

const token = String(import.meta.env.VITE_MIXPANEL_TOKEN ?? "").trim();
let initialized = false;
let context: MixpanelContext = {};
const onceKeys = new Set<string>();

export function initializeWidgetMixpanel(nextContext: MixpanelContext = {}): void {
  context = { ...context, ...nextContext };
  if (initialized || !token || typeof window === "undefined") return;
  mixpanel.init(token, {
    api_host: String(import.meta.env.VITE_MIXPANEL_API_HOST ?? "https://api-js.mixpanel.com"),
    track_pageview: false,
    autocapture: false,
    persistence: "localStorage",
    ip: false,
    ignore_dnt: false,
    record_sessions_percent: 0,
  });
  initialized = true;
  mixpanel.register(sanitizeMixpanelProperties(context));
}

export function trackWidgetMixpanel(event: MixpanelEvent, properties: Record<string, unknown> = {}): void {
  initializeWidgetMixpanel();
  if (!initialized) return;
  mixpanel.track(event, sanitizeMixpanelProperties(properties, context));
}

export function trackWidgetMixpanelOnce(key: string, event: MixpanelEvent, properties: Record<string, unknown> = {}): void {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  trackWidgetMixpanel(event, properties);
}
