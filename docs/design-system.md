# FrontDeskWise design system

FrontDeskWise has two product surfaces with one shared visual language:

- **Operations** — the super-admin control plane for organizations, access, demo operations, billing interventions, and system health.
- **Workspace** — the business-owner dashboard for knowledge, conversations, leads, agent configuration, widget installation, analytics, and billing.

## Foundations

The implementation lives in `apps/web/src/styles.css`. The `--ds-*` variables are the source of truth for new UI work:

- Typography: Inter/system sans; display text uses a tight tracking scale and body text uses readable 1.5–1.65 line height.
- Color: navy/blue for navigation and primary actions; slate for text; green for healthy/success; amber for attention; red for destructive or failed states; purple for intelligence/readiness.
- Spacing: 4px base rhythm with named steps from `--ds-space-1` through `--ds-space-8`.
- Shape: 8px controls, 12px grouped surfaces, 16px cards, pill status tags.
- Elevation: restrained card shadow; borders carry most of the hierarchy.
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

The next slices should add business-level inspection and billing overrides as dedicated detail views, using the existing admin API routes rather than duplicating owner-dashboard controls.

## Delivery sequence

1. Stabilize shell and tokens (current slice).
2. Add organization and business detail drawers with consistent tables and status language.
3. Standardize workspace surfaces: overview, knowledge, conversations, leads, agent/widget, analytics, billing.
4. Standardize the embeddable widget preview and install states against the same token set.
5. Add visual regression checks for desktop, mobile, empty, loading, error, and read-only states.
