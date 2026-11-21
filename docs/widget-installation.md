# Widget installation

FrontDeskWise uses one public script snippet for every website platform. The public site key identifies the business; it is not a database credential or provider secret.

## Basic snippet

```html
<script
  async
  src="https://www.frontdeskwise.com/widget.js"
  data-site="fdw_public_site_key"
></script>
```

The install endpoint may also include deployment overrides:

```html
<script
  async
  src="https://www.frontdeskwise.com/widget.js"
  data-site="fdw_public_site_key"
  data-api="https://api.frontdeskwise.com"
  data-shell="https://www.frontdeskwise.com/widget-shell.js"
></script>
```

Parameters:

- `data-site` is required and identifies the business.
- `data-api` is optional. If omitted, the API origin is derived from `src`.
- `data-shell` is optional. If omitted, the deferred shell is derived as `widget-shell.js` beside the loader.
- `data-pages` is optional. If omitted, the widget runs on every page where the script is installed.

## Page scoping

Use `data-pages` when the script is installed in a global header but the widget should appear only on selected paths:

```html
<script
  async
  src="https://www.frontdeskwise.com/widget.js"
  data-site="fdw_public_site_key"
  data-pages="/"
></script>
```

`data-pages` is a comma-separated list of URL path patterns:

```html
data-pages="/,/pricing,/services/*"
```

Matching rules:

- Paths are matched against `window.location.pathname`.
- Query strings and hash fragments are ignored.
- Trailing slashes are normalized, so `/pricing` matches `/pricing/`.
- A terminal `*` matches a path and its descendants, so `/services/*` matches `/services`, `/services/`, and `/services/hair`.
- `*` or `/*` matches every path.
- A bare value such as `pricing` is treated as `/pricing`; semantic labels such as `marketing` do not map to a platform-specific page automatically.

When the current path does not match, the loader exits before creating the widget host, fetching configuration, or starting proactive engagement. This keeps a marketing-only installation out of the rest of the site. If the script is placed only on one page, `data-pages` is unnecessary.

The page rule is evaluated when the script runs. Traditional multi-page navigation evaluates it again on each page load. Single-page applications should re-run the loader or update their integration when the route changes.

## Verification

After installation, use the owner dashboard's **Check installation** action. A successful check confirms that the public script loaded for the correct business and that the widget load was recorded.

