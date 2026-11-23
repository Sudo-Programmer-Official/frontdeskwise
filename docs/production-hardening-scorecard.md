# FrontDeskWise production hardening scorecard

Updated 2026-11-22.

## Implemented controls

- **PASS — verified identity:** Firebase email verification is requested at signup, surfaced in the web app, and required for workspace, business, demo-verification, and installation-support mutations.
- **PASS — tenant isolation:** Existing business/team ownership checks remain server-side; action execution now rejects foreign-business, disabled, unapproved, malformed, and unsupported-connector actions.
- **PASS — SSRF protection:** Website crawling, rendered crawling, preview probes, verification-page fetches, generic webhooks, and vendor connectors validate redirect targets and reject private/link-local destinations.
- **PASS — abuse telemetry:** Rate-limit, authentication, authorization, prompt-injection, and widget-abuse events are recorded with hashed request identifiers and bounded metadata.
- **PASS — privileged audit trail:** Mutation responses under auth, demo, and admin surfaces are recorded in `privileged_audit_events` with actor, tenant, request, status, and bounded before/after metadata fields.
- **PASS — production schema:** Migration `072_security_events_and_verified_identity.sql` adds verified-identity state and the security/audit event tables.

## Rollout warnings

- **WARN — distributed rate limits:** The existing limiter is process-local. Put API/widget limits behind a shared store or edge/WAF before running multiple API instances, and set `FRONTDESKWISE_TRUST_PROXY=true` only after the edge is configured to rewrite forwarded headers.
- **WARN — admin MFA:** Super-admin authorization exists, but a separate MFA/step-up requirement is still a launch decision.
- **WARN — CAPTCHA escalation:** Repeated prompt-injection and abuse events are throttled and logged; CAPTCHA/challenge escalation is not yet wired to a provider.
- **WARN — web bundle:** The current production build reports a large main chunk (about 913 kB in the verified build). Add route-level lazy loading and review third-party imports before broad launch.
- **WARN — operational SLOs:** Instrumentation and audit data are present, but p50/p95 dashboards, alert thresholds, and restore drills still need to be run against the production deployment.

## Pre-launch verification

- **NOT TESTED — database rollout:** Apply the migration in staging, run the existing integration suite against it, and verify indexes/query plans.
- **NOT TESTED — identity provider:** Confirm Firebase verification templates, authorized domains, resend limits, and the Google sign-in behavior in the production project.
- **NOT TESTED — edge behavior:** Verify trusted proxy configuration, forwarded-IP handling, WAF rules, and shared rate-limit behavior at the deployed boundary.
- **NOT TESTED — recovery:** Run a backup restore and confirm security/audit events remain queryable after recovery.
