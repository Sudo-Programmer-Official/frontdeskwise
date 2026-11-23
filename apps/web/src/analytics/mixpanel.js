import mixpanel from "mixpanel-browser";
import { environmentName, sanitizeMixpanelProperties, } from "./mixpanel-schema";
export { MIXPANEL_EVENTS } from "./mixpanel-schema";
const token = String(import.meta.env.VITE_MIXPANEL_TOKEN ?? "").trim();
const replayEnabled = String(import.meta.env.VITE_MIXPANEL_SESSION_REPLAY ?? "").trim().toLowerCase() === "true";
const sensitiveSelectors = [
    "[data-mixpanel-block]",
    "[data-sensitive]",
    ".fdw-sensitive",
    ".fdw-widget-root",
    ".conversation-thread",
    ".inbox-message-thread",
    ".auth-card",
    ".lead-detail-modal",
    ".fdw-widget",
].join(",");
let initialized = false;
let context = {};
const onceKeys = new Set();
export function initializeMixpanel() {
    if (initialized || !token || typeof window === "undefined")
        return;
    mixpanel.init(token, {
        api_host: String(import.meta.env.VITE_MIXPANEL_API_HOST ?? "https://api-js.mixpanel.com"),
        track_pageview: false,
        persistence: "localStorage",
        ip: false,
        ignore_dnt: false,
        autocapture: replayEnabled ? {
            click: true,
            input: true,
            submit: true,
            capture_text_content: false,
            rage_click: true,
            dead_click: true,
            block_selectors: [sensitiveSelectors],
        } : false,
        record_sessions_percent: replayEnabled ? 100 : 0,
        record_mask_all_text: true,
        record_mask_all_inputs: true,
        record_mask_text_selector: [sensitiveSelectors],
        record_mask_input_selector: ["input", "textarea", "select", sensitiveSelectors],
        record_block_selector: sensitiveSelectors,
        record_heatmap_data: replayEnabled,
    });
    initialized = true;
    if (Object.keys(context).length)
        mixpanel.register(sanitizeMixpanelProperties(context));
}
export function setMixpanelContext(next) {
    context = Object.fromEntries(Object.entries({ ...context, ...next }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    initializeMixpanel();
    if (initialized)
        mixpanel.register(sanitizeMixpanelProperties(context));
}
export function trackMixpanel(event, properties = {}) {
    initializeMixpanel();
    if (!initialized)
        return;
    mixpanel.track(event, sanitizeMixpanelProperties(properties, context));
}
export function trackMixpanelOnce(key, event, properties = {}) {
    if (onceKeys.has(key))
        return;
    onceKeys.add(key);
    trackMixpanel(event, properties);
}
export function identifyMixpanelUser(userId, properties = {}) {
    const normalizedId = userId.trim();
    if (!normalizedId)
        return;
    initializeMixpanel();
    if (!initialized)
        return;
    mixpanel.identify(normalizedId);
    setMixpanelContext(properties);
}
export function resetMixpanelUser() {
    if (initialized)
        mixpanel.reset();
    context = {};
    onceKeys.clear();
}
export function mixpanelEnabled() {
    return Boolean(token);
}
export function mixpanelConfigSummary() {
    return { enabled: mixpanelEnabled(), replayEnabled, environment: environmentName() };
}
