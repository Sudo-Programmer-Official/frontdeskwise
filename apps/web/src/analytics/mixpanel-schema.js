export const MIXPANEL_EVENTS = {
    SIGNUP_STARTED: "onboarding.signup.started",
    SIGNUP_COMPLETED: "onboarding.signup.completed",
    EMAIL_VERIFIED: "onboarding.email.verified",
    BUSINESS_CREATED: "onboarding.business.created",
    WEBSITE_SUBMITTED: "onboarding.website.submitted",
    CRAWL_COMPLETED: "onboarding.crawl.completed",
    BUSINESS_BRAIN_READY: "onboarding.business_brain.ready",
    ACTION_GENERATED: "workflow.action.generated",
    WORKFLOW_GENERATED: "workflow.generated",
    WORKFLOW_EDITED: "workflow.edited",
    WORKFLOW_TEST_STARTED: "workflow.test.started",
    WORKFLOW_TEST_PASSED: "workflow.test.passed",
    WORKFLOW_PUBLISHED: "workflow.published",
    INTEGRATION_CONNECTED: "integration.connected",
    WIDGET_INSTALLED: "onboarding.widget.installed",
    CONVERSATION_STARTED: "conversation.started",
    HUMAN_REQUESTED: "conversation.handoff.requested",
    STAFF_TAKEOVER: "conversation.handoff.taken_over",
    CONVERSATION_RESOLVED: "conversation.resolved",
    PRIMARY_CTA_SHOWN: "cta.primary.shown",
    PRIMARY_CTA_CLICKED: "cta.primary.clicked",
    CTA_CONVERSION_COMPLETED: "cta.conversion.completed",
    PWA_INSTALL_PROMPT_SHOWN: "operator.pwa.install_prompt.shown",
    PWA_INSTALLED: "operator.pwa.installed",
    PUSH_NOTIFICATIONS_ENABLED: "operator.push_notifications.enabled",
    MOBILE_TAKEOVER_CONFIRMED: "conversation.handoff.mobile_takeover_confirmed",
};
// Product analytics is intentionally narrower than internal telemetry. Keep
// this list explicit so adding a component prop cannot accidentally add PII.
const ALLOWED_PROPERTIES = new Set([
    "organization_id",
    "business_id",
    "user_role",
    "plan",
    "business_type",
    "publication_version",
    "source",
    "environment",
    "surface",
    "site_key",
    "is_public_demo",
    "route",
    "status",
    "success",
    "method",
    "provider",
    "action_id",
    "action_key",
    "action_type",
    "execution_mode",
    "tracking_key",
    "workflow_id",
    "workflow_key",
    "conversation_status",
    "entrypoint",
    "cta_source",
    "platform",
    "step",
    "count",
    "duration_ms",
    "url_host",
    "reason",
    "resumed",
    "is_public_demo",
    "readiness_score",
    "source_count",
    "message_count",
]);
const SENSITIVE_KEY = /(email|phone|name|message|question|content|input|text|token|secret|password|credential|lead|contact|raw|body|value|website_url|source_url)/i;
export function environmentName() {
    const mode = String(import.meta.env.MODE ?? "production").trim().toLowerCase();
    return mode === "development" || mode === "test" ? mode : "production";
}
export function sanitizeMixpanelProperties(properties = {}, context = {}) {
    const output = { environment: environmentName() };
    for (const [key, value] of Object.entries({ ...context, ...properties })) {
        if (!ALLOWED_PROPERTIES.has(key) || SENSITIVE_KEY.test(key))
            continue;
        if (typeof value === "boolean") {
            output[key] = value;
            continue;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            output[key] = value;
            continue;
        }
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed && trimmed.length <= 160)
                output[key] = trimmed;
        }
    }
    return output;
}
export function safeUrlHost(value) {
    try {
        const url = new URL(value);
        return url.hostname.toLowerCase().replace(/^www\./, "");
    }
    catch {
        return undefined;
    }
}
