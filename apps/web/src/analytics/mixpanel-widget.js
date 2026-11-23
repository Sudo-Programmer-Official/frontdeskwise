import mixpanel from "mixpanel-browser/src/loaders/loader-module-core";
import { sanitizeMixpanelProperties, } from "./mixpanel-schema";
export { MIXPANEL_EVENTS } from "./mixpanel-schema";
const token = String(import.meta.env.VITE_MIXPANEL_TOKEN ?? "").trim();
let initialized = false;
let context = {};
const onceKeys = new Set();
export function initializeWidgetMixpanel(nextContext = {}) {
    context = { ...context, ...nextContext };
    if (initialized || !token || typeof window === "undefined")
        return;
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
export function trackWidgetMixpanel(event, properties = {}) {
    initializeWidgetMixpanel();
    if (!initialized)
        return;
    mixpanel.track(event, sanitizeMixpanelProperties(properties, context));
}
export function trackWidgetMixpanelOnce(key, event, properties = {}) {
    if (onceKeys.has(key))
        return;
    onceKeys.add(key);
    trackWidgetMixpanel(event, properties);
}
