# FrontDeskWise design system

FrontDeskWise has two product surfaces with one shared visual language:

- **Operations** — the super-admin control plane for organizations, access, demo operations, billing interventions, and system health.
- **Workspace** — the business-owner dashboard for knowledge, conversations, leads, agent configuration, widget installation, analytics, and billing.

## Foundations

The implementation lives in `apps/web/src/styles.css`. The `--ds-*` variables are the source of truth for new UI work:

- Typography: Inter is the primary product font, loaded with a system-sans fallback; display text uses a tight tracking scale and body text uses readable 1.5 line height.
- Color: navy/blue for navigation and primary actions; slate for text; green for healthy/success; amber for attention; red for destructive or failed states; purple for intelligence/readiness.
- Spacing: 4px base rhythm with named steps from `--ds-space-1` through `--ds-space-8`.
- Shape: 8px controls, 10–14px grouped surfaces, and pill status tags. Keep control heights compact and consistent across the owner and operations shells.
- Elevation: restrained two-layer card shadow; borders carry most of the hierarchy and surfaces should not look inflated.
- Focus: use the shared blue focus ring and preserve visible keyboard focus.

## Component rules

1. Use one page title, one supporting sentence, and one primary action per surface.
2. Use `ds-card` for new grouped surfaces and `ds-stat-card` for operational metrics.
3. Use `status-pill` only for state, never for navigation or a generic label.
4. Use `primary-button` for the one main action; use `outline-button` for secondary actions; use `text-button` for low-emphasis actions.
5. Keep labels sentence case and action verbs explicit: “Generate test link”, “Refresh checks”, “Approve answer”.
6. Empty, loading, error, and success states must be visible inside the surface they describe.
7. The operations shell must not render owner-only controls when the super-admin has no business selected.

## Super-admin information architecture

The first control-plane slice is intentionally small and operational:

- **Command center** — organization count, trials, outcomes, attention queue, and system health.
- **Organizations** — plan/status, business capacity, leads/conversations, trial extension, suspension.
- **Users & access** — application users, organization membership, status, super-admin protection.
- **Demo operations** — requests, temporary test users, access links, validation, extension, reset, and revoke.
- **System health** — API/database, object storage, email readiness, and controlled SES test.

The organization detail surface now adds business-level inspection and controlled billing interventions without duplicating owner-dashboard controls. It includes business ownership/billing status, source and outcome counts, organization members, trial/suspension actions, ownership approval, and reason-required plan overrides.

Owner workspace alignment now uses the same tokens for dashboard cards, panels, form controls, focus states, and the Agent preview. The widget keeps its customer-facing visual treatment while sharing the same border, surface, typography, spacing, and focus rules. The owner workflow also uses the same interaction language for source lifecycle, lead operations, CRM disconnects, and explicit widget verification.

The owner navigation is intentionally outcome-oriented:

- **Operate** — Overview, Inbox, Leads, Analytics.
- **Build** — Knowledge, Actions, Agent.
- **Business** — Businesses, Settings.

Team, Integrations, Verification, and Billing are Settings sections rather than daily destinations. Test Agent remains a contextual action from Agent and from readiness checks, so the sidebar does not turn every configuration surface into a peer destination.

The shared product pass also standardizes sidebar density, business-switcher contrast, native select rendering, form control height, button hierarchy, status pills, and heading weights. Business names stay white and legible in the dark navigation; dropdown options use a light surface with dark text so the native menu remains readable.

## Delivery sequence

1. Stabilize shell and tokens (complete).
2. Add organization and business detail views with consistent tables and status language (complete).
3. Add controlled billing interventions and keep business billing projections synchronized (complete).
4. Standardize workspace surfaces: overview, knowledge, conversations, leads, analytics, billing, and actions (complete).
5. Finish the embeddable widget preview and install states against the same token set (complete; desktop/mobile preview and verification are live).
6. Add visual regression checks for desktop, mobile, empty, loading, error, and read-only states (the production smoke gate is in place; screenshot coverage remains a release-operations task).
7. Keep trust and conversion controls in the same system: proactive engagement, visitor continuity, consent/privacy settings, retention, lead deletion, and owner-visible evaluation states use the same compact labels, status language, focus treatment, and responsive layout rules.
