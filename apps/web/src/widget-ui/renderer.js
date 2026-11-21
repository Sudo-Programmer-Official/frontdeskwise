import { renderMarkdownInto, safeLinkUrl } from "./markdown";
const DEFAULT_ACCENT = "#0d6efd";
export const DEFAULT_CONFIG = {
    assistantName: "AI front desk",
    welcomeMessage: "Hi! How can I help?",
    widgetColor: DEFAULT_ACCENT,
    widgetTheme: "auto",
    widgetPosition: "bottom-right",
    widgetDefaultMode: "compact",
    widgetAllowExpand: true,
    widgetQuickActions: [],
    showAiDisclosure: true,
    showPoweredBy: true,
    showSources: true,
    showLeadCapture: true,
    requireLeadConsent: false,
};
const SYMBOL = "<svg class=\"fdw-brand-symbol\" viewBox=\"0 0 64 64\" aria-hidden=\"true\"><path d=\"m32 12 4.8 12.2L49 29l-12.2 4.8L32 46l-4.8-12.2L15 29l12.2-4.8L32 12Z\" fill=\"currentColor\"></path></svg>";
const WIDGET_STYLES = `
  :host { all: initial; }
  .fdw-widget-root, .fdw-widget-root * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .fdw-widget-root { color: #182b49; font-size: 16px; }
  /* The live loader host is intentionally pointer-transparent while it only
     owns the launcher. The shell reuses that host, so the embed root must
     opt its interactive subtree back into hit testing once it is mounted. */
  .fdw-embed-root { pointer-events: auto; }
  .fdw-brand-symbol { display: block; width: 26px; height: 26px; }
  .fdw-launcher { position: fixed; right: 22px; bottom: 22px; z-index: 2147483000; display: grid; place-items: center; width: 58px; height: 58px; border: 0; border-radius: 18px; color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); box-shadow: 0 14px 30px rgba(13, 75, 160, .28); cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
  .fdw-launcher:hover { transform: translateY(-2px); box-shadow: 0 18px 34px rgba(13, 75, 160, .34); }
  .fdw-launcher[hidden], .fdw-proactive-teaser[hidden] { display: none; }
  .fdw-launcher.fdw-position-bottom-left { right: auto; left: 22px; }
  .fdw-proactive-teaser { position: fixed; right: 22px; bottom: 92px; z-index: 2147483000; display: flex; align-items: flex-start; gap: 9px; width: min(320px, calc(100vw - 32px)); padding: 14px 13px; border: 1px solid #d3e1f2; border-radius: 14px; color: #244d7e; background: #fff; box-shadow: 0 18px 42px rgba(13, 44, 91, .2); }
  .fdw-proactive-teaser.fdw-position-bottom-left { right: auto; left: 22px; }
  .fdw-teaser-mark { display: grid; width: 28px; height: 28px; flex: 0 0 28px; place-items: center; border-radius: 9px; color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); }
  .fdw-teaser-copy { min-width: 0; flex: 1; }
  .fdw-teaser-copy p { margin: 0; font-size: 12px; font-weight: 650; line-height: 1.4; }
  .fdw-teaser-action { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 0; border: 0; color: var(--fdw-accent, #0d6efd); background: transparent; cursor: pointer; font-size: 11px; font-weight: 800; }
  .fdw-teaser-dismiss { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; margin: -4px -4px 0 0; border: 0; border-radius: 50%; color: #6c7e94; background: transparent; cursor: pointer; font-size: 17px; line-height: 1; }
  .fdw-teaser-dismiss:hover, .fdw-teaser-dismiss:focus-visible { color: #244d7e; background: #edf4fc; outline: none; }
  .fdw-panel { position: fixed; right: 22px; bottom: 92px; z-index: 2147483000; display: none; flex-direction: column; width: min(420px, calc(100vw - 32px)); height: min(680px, calc(100vh - 120px)); overflow: hidden; border: 1px solid #d7e1ee; border-radius: 18px; color: #182b49; background: #fff; box-shadow: 0 24px 70px rgba(13, 44, 91, .24); }
  .fdw-panel.fdw-open { display: flex; }
  .fdw-panel.fdw-mode-expanded { width: min(760px, calc(100vw - 48px)); height: min(760px, calc(100vh - 48px)); }
  .fdw-panel.fdw-mode-fullscreen { right: 0; bottom: 0; width: min(920px, 100vw); height: 100dvh; border-radius: 0; }
  .fdw-panel.fdw-position-bottom-left { right: auto; left: 22px; }
  .fdw-panel.fdw-theme-dark { color: #eef5ff; background: #182a43; border-color: #2f4768; }
  .fdw-panel.fdw-theme-dark .fdw-messages, .fdw-panel.fdw-theme-dark .fdw-quick-actions { background: #122238; }
  .fdw-panel.fdw-theme-dark .fdw-message { color: #e4edf9; background: #243b5c; border-color: #385578; }
  .fdw-panel.fdw-theme-dark .fdw-composer { background: #182a43; border-color: #2f4768; }
  .fdw-panel.fdw-theme-dark .fdw-composer input { color: #eef5ff; background: #243b5c; border-color: #385578; }
  .fdw-system-status { display: none; align-items: flex-start; gap: 8px; margin: 10px 15px 0; padding: 10px 11px; border: 1px solid #d7e5f5; border-radius: 10px; color: #36577e; background: #f4f8fe; font-size: 11px; line-height: 1.4; }
  .fdw-system-status.fdw-visible { display: flex; }
  .fdw-system-status.fdw-warning { border-color: #f0d6a7; color: #7a5a1d; background: #fff9ed; }
  .fdw-system-status.fdw-error { border-color: #efc7c5; color: #8b403b; background: #fff5f4; }
  .fdw-system-status-copy { min-width: 0; flex: 1; }
  .fdw-system-status-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 7px; }
  .fdw-system-status-actions button, .fdw-system-status-actions a { padding: 5px 7px; border: 1px solid #b9d0ec; border-radius: 6px; color: #24588d; background: #fff; cursor: pointer; font-size: 10px; font-weight: 750; text-decoration: none; }
  .fdw-system-status-actions button:hover, .fdw-system-status-actions a:hover, .fdw-system-status-actions button:focus-visible, .fdw-system-status-actions a:focus-visible { border-color: var(--fdw-accent, #0d6efd); color: var(--fdw-accent, #0d6efd); outline: none; }
  .fdw-message-meta { display: flex; align-items: center; gap: 7px; margin-top: 7px; color: #8a98aa; font-size: 10px; }
  .fdw-message.fdw-message-failed { border-color: #efc7c5; background: #fff8f7; }
  .fdw-message-retry { padding: 0; border: 0; color: #b34843; background: transparent; cursor: pointer; font-size: 10px; font-weight: 800; text-decoration: underline; }
  .fdw-panel.fdw-theme-dark .fdw-system-status, .fdw-panel.fdw-theme-auto .fdw-system-status { background: #243b5c; border-color: #385578; color: #e4edf9; }
  .fdw-panel.fdw-theme-dark .fdw-message.fdw-message-failed, .fdw-panel.fdw-theme-auto .fdw-message.fdw-message-failed { background: #49343d; border-color: #74505b; }
  .fdw-header { display: flex; align-items: center; gap: 10px; min-height: 66px; padding: 13px 15px; color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); }
  .fdw-identity { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
  .fdw-logo, .fdw-orb { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,.2); }
  .fdw-orb { color: var(--fdw-accent-text, #fff); }
  .fdw-logo { object-fit: cover; background: #fff; }
  .fdw-title-group { display: grid; gap: 2px; min-width: 0; }
  .fdw-title-group strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; letter-spacing: -.01em; }
  .fdw-title-group small { display: flex; align-items: center; gap: 5px; color: currentColor; opacity: .74; font-size: 10px; }
  .fdw-status-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: #2bd99b; box-shadow: 0 0 0 2px rgba(43,217,155,.14); }
  .fdw-status-dot.fdw-status-dot-waiting { background: #f6b73c; box-shadow: 0 0 0 2px rgba(246,183,60,.16); }
  .fdw-status-dot.fdw-status-dot-inactive { background: #a5b4c7; box-shadow: 0 0 0 2px rgba(165,180,199,.16); }
  .fdw-header-actions { display: flex; gap: 4px; }
  .fdw-header-actions button { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px; color: currentColor; background: transparent; cursor: pointer; font-size: 17px; }
  .fdw-header-actions button:hover, .fdw-header-actions button:focus-visible { background: rgba(255,255,255,.16); outline: none; }
  .fdw-messages { display: flex; flex: 1; flex-direction: column; align-content: flex-start; gap: 10px; min-height: 0; overflow: auto; padding: 18px 16px 12px; background: #f8fafd; }
  .fdw-message { align-self: flex-start; max-width: min(88%, 560px); padding: 11px 12px; border: 1px solid #e1e9f3; border-radius: 6px 14px 14px 14px; color: #445873; background: #fff; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
  .fdw-message.fdw-user { align-self: flex-end; border-color: var(--fdw-accent, #0d6efd); border-radius: 14px 6px 14px 14px; color: #fff; background: var(--fdw-accent, #0d6efd); }
  .fdw-message a { display: block; margin-top: 8px; color: #1769c2; font-size: 11px; font-weight: 800; }
  .fdw-message.fdw-user a { color: #fff; }
  .fdw-message p { margin: 0 0 9px; }
  .fdw-message p:last-child { margin-bottom: 0; }
  .fdw-message ol, .fdw-message ul { margin: 7px 0 9px; padding-left: 21px; }
  .fdw-message li + li { margin-top: 4px; }
  .fdw-message code { padding: 1px 4px; border-radius: 4px; background: #edf4fc; font-size: .92em; }
  .fdw-quick-actions { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 16px 13px; background: #f8fafd; }
  .fdw-quick-actions:empty { display: none; }
  .fdw-quick-actions button { padding: 8px 10px; border: 1px solid #bfd4ed; border-radius: 999px; color: #20558e; background: #fff; cursor: pointer; font-size: 11px; font-weight: 750; }
  .fdw-quick-actions button:hover, .fdw-quick-actions button:focus-visible { border-color: var(--fdw-accent, #0d6efd); color: var(--fdw-accent, #0d6efd); outline: none; }
  .fdw-quick-actions .fdw-primary-cta { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 9px 13px; border-color: var(--fdw-accent, #0d6efd); color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); font-weight: 800; text-decoration: none; transition: transform .16s ease, background-color .16s ease, box-shadow .16s ease; }
  .fdw-quick-actions .fdw-primary-cta:hover { color: var(--fdw-accent-text, #fff); background: color-mix(in srgb, var(--fdw-accent, #0d6efd) 88%, #000); transform: translateY(-1px); }
  .fdw-quick-actions .fdw-primary-cta:focus-visible { color: var(--fdw-accent-text, #fff); background: color-mix(in srgb, var(--fdw-accent, #0d6efd) 88%, #000); outline: 3px solid rgba(13,110,253,.28); outline-offset: 3px; }
  .fdw-quick-actions .fdw-primary-cta[href]::after, .fdw-action-link::after { content: "↗"; display: inline-block; margin-left: 7px; font-size: .95em; line-height: 1; }
  .fdw-action-form, .fdw-lead { display: grid; gap: 11px; margin: 0 15px 13px; padding: 15px; border: 1px solid #dbe7f8; border-radius: 13px; background: #f7faff; }
  .fdw-action-error { color: #a54b45; font-size: 11px; line-height: 1.4; }
  .fdw-action-form:empty, .fdw-lead[hidden] { display: none; }
  .fdw-action-form label, .fdw-lead label:not(.fdw-consent-row) { display: grid; gap: 5px; color: #52657e; font-size: 11px; font-weight: 750; }
  .fdw-action-form label > span:first-child, .fdw-lead label:not(.fdw-consent-row) > span { display: flex; align-items: baseline; justify-content: space-between; gap: 5px; }
  .fdw-action-form label > span:first-child em, .fdw-lead label:not(.fdw-consent-row) em { color: #9aa7b7; font-size: 10px; font-style: normal; font-weight: 500; }
  .fdw-action-form label > span:first-child b, .fdw-lead b { color: #c34e47; }
  .fdw-action-form input, .fdw-action-form select, .fdw-lead input { width: 100%; min-height: 40px; padding: 10px 11px; border: 1px solid #cbd7e5; border-radius: 8px; outline: none; color: #243957; background: #fff; font-size: 12px; }
  .fdw-action-form input:focus, .fdw-action-form select:focus, .fdw-lead input:focus, .fdw-composer input:focus { border-color: var(--fdw-accent, #0d6efd); box-shadow: 0 0 0 3px rgba(13,110,253,.12); }
  .fdw-action-form button, .fdw-lead button { min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); cursor: pointer; font-size: 12px; font-weight: 800; }
  .fdw-action-link { display: inline-flex; width: max-content; max-width: 100%; min-height: 44px; align-items: center; justify-content: center; margin: 4px 0 2px; padding: 10px 13px; border-radius: 8px; color: var(--fdw-accent-text, #fff); background: var(--fdw-accent, #0d6efd); cursor: pointer; font-size: 12px; font-weight: 800; text-align: center; text-decoration: none; transition: transform .16s ease, background-color .16s ease, box-shadow .16s ease; }
  .fdw-action-link:hover { color: var(--fdw-accent-text, #fff); background: color-mix(in srgb, var(--fdw-accent, #0d6efd) 88%, #000); transform: translateY(-1px); }
  .fdw-action-link:focus-visible { color: var(--fdw-accent-text, #fff); background: color-mix(in srgb, var(--fdw-accent, #0d6efd) 88%, #000); outline: 3px solid rgba(13,110,253,.28); outline-offset: 3px; }
  .fdw-lead { display: none; gap: 10px; }
  .fdw-lead.fdw-visible { display: grid; }
  .fdw-lead-heading { display: grid; gap: 4px; margin-bottom: 2px; }
  .fdw-lead-heading strong { color: #1f3658; font-size: 13px; letter-spacing: -.01em; }
  .fdw-lead-heading small { color: #687b94; font-size: 10px; line-height: 1.4; }
  .fdw-action-form label.fdw-consent-row, .fdw-lead label.fdw-consent-row { display: flex; width: 100%; min-width: 0; gap: 7px; align-items: flex-start; color: #687b94; font-size: 10px; font-weight: 500; line-height: 1.4; }
  .fdw-consent-row > span { display: block; min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .fdw-action-form .fdw-consent-row input, .fdw-lead .fdw-consent-row input { width: 15px; height: 15px; min-width: 15px; min-height: 15px; flex: 0 0 15px; margin: 1px 0 0; padding: 0; border: 0; border-radius: 3px; accent-color: var(--fdw-accent, #0d6efd); }
  .fdw-consent-row[hidden], .fdw-consent-saved[hidden] { display: none; }
  .fdw-consent-row a { color: #1769c2; font-weight: 700; }
  .fdw-consent-saved { display: flex; gap: 7px; align-items: flex-start; color: #687b94; font-size: 10px; font-weight: 500; line-height: 1.4; }
  .fdw-consent-saved-mark { color: #1d9b78; font-weight: 800; }
  .fdw-handoff-status { display: none; align-items: flex-start; gap: 8px; margin: 0 15px 10px; padding: 9px 8px 9px 11px; border: 1px solid #cfe0f7; border-radius: 9px; color: #36577e; background: #f3f8ff; font-size: 11px; line-height: 1.4; }
  .fdw-handoff-status.fdw-visible { display: flex; }
  .fdw-handoff-content { display: grid; gap: 8px; min-width: 0; flex: 1; }
  .fdw-handoff-copy { min-width: 0; }
  .fdw-handoff-actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .fdw-handoff-actions[hidden] { display: none; }
  .fdw-handoff-actions button { padding: 5px 7px; border: 1px solid #b9d0ec; border-radius: 6px; color: #24588d; background: #fff; cursor: pointer; font-size: 10px; font-weight: 750; }
  .fdw-handoff-actions button:hover, .fdw-handoff-actions button:focus-visible { border-color: var(--fdw-accent, #0d6efd); color: var(--fdw-accent, #0d6efd); outline: none; }
  .fdw-handoff-dismiss { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; margin: -4px -3px 0 0; padding: 0; border: 0; border-radius: 50%; color: #547194; background: transparent; cursor: pointer; font-size: 17px; line-height: 1; }
  .fdw-handoff-dismiss:hover, .fdw-handoff-dismiss:focus-visible { color: #244d7e; background: #e3effd; outline: none; }
  .fdw-composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e6edf5; background: #fff; }
  .fdw-composer input { min-width: 0; flex: 1; padding: 11px 12px; border: 1px solid #d5e0ed; border-radius: 9px; outline: none; color: #243957; font-size: 12px; }
  .fdw-composer button { width: 40px; border: 0; border-radius: 9px; color: #fff; background: var(--fdw-accent, #0d6efd); cursor: pointer; font-size: 15px; font-weight: 800; }
  .fdw-powered-by { display: grid; grid-template-columns: minmax(24px, 1fr) auto minmax(24px, 1fr); align-items: center; gap: 9px; min-height: 38px; padding: 0 15px 11px; color: #8a98aa; background: #fff; font-size: 10px; }
  .fdw-powered-by::before, .fdw-powered-by::after { content: ""; height: 1px; background: #e6edf5; }
  .fdw-powered-by-label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .fdw-powered-by .fdw-brand-symbol { width: 15px; height: 15px; color: var(--fdw-accent, #0d6efd); }
  .fdw-powered-by strong { color: #52657e; font-size: 10px; font-weight: 800; letter-spacing: -.01em; }
  .fdw-panel.fdw-theme-dark .fdw-powered-by { color: #a5b5cc; background: #182a43; }
  .fdw-panel.fdw-theme-dark .fdw-powered-by::before, .fdw-panel.fdw-theme-dark .fdw-powered-by::after { background: #385578; }
  .fdw-panel.fdw-theme-dark .fdw-powered-by .fdw-brand-symbol, .fdw-panel.fdw-theme-dark .fdw-powered-by strong { color: #eef5ff; }
  .fdw-typing { display: inline-flex; gap: 4px; width: max-content; padding: 11px 13px; border-radius: 6px 14px 14px 14px; background: #fff; }
  .fdw-typing span { width: 5px; height: 5px; border-radius: 50%; background: #7f91aa; animation: fdw-typing-bounce 1s infinite ease-in-out; }
  .fdw-typing span:nth-child(2) { animation-delay: .14s; }
  .fdw-typing span:nth-child(3) { animation-delay: .28s; }
  .fdw-typing small { margin-left: 4px; color: #7f91aa; font-size: 10px; font-weight: 650; }
  @keyframes fdw-typing-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }
  .fdw-preview-root { position: absolute; z-index: 4; inset: 0; pointer-events: none; }
  .fdw-preview-root .fdw-launcher, .fdw-preview-root .fdw-proactive-teaser, .fdw-preview-root .fdw-panel { position: absolute; pointer-events: auto; }
  .fdw-preview-root .fdw-panel { right: 22px; bottom: 22px; height: min(680px, calc(100% - 44px)); }
  .fdw-preview-root .fdw-panel.fdw-mode-expanded { height: min(760px, calc(100% - 44px)); }
  .fdw-preview-root .fdw-panel.fdw-mode-fullscreen { right: 0; bottom: 0; height: 100%; }
  .fdw-preview-root .fdw-launcher { right: 22px; bottom: 22px; }
  .fdw-preview-root .fdw-proactive-teaser { right: 22px; bottom: 92px; }
  @media (prefers-color-scheme: dark) {
    .fdw-panel.fdw-theme-auto { color: #eef5ff; background: #182a43; border-color: #2f4768; }
    .fdw-panel.fdw-theme-auto .fdw-messages, .fdw-panel.fdw-theme-auto .fdw-quick-actions { background: #122238; }
    .fdw-panel.fdw-theme-auto .fdw-message { color: #e4edf9; background: #243b5c; border-color: #385578; }
    .fdw-panel.fdw-theme-auto .fdw-composer { background: #182a43; border-color: #2f4768; }
    .fdw-panel.fdw-theme-auto .fdw-composer input { color: #eef5ff; background: #243b5c; border-color: #385578; }
    .fdw-panel.fdw-theme-auto .fdw-powered-by { color: #a5b5cc; background: #182a43; }
    .fdw-panel.fdw-theme-auto .fdw-powered-by::before, .fdw-panel.fdw-theme-auto .fdw-powered-by::after { background: #385578; }
    .fdw-panel.fdw-theme-auto .fdw-powered-by .fdw-brand-symbol, .fdw-panel.fdw-theme-auto .fdw-powered-by strong { color: #eef5ff; }
  }
  @media (max-width: 640px) {
    .fdw-launcher { right: 16px; bottom: 16px; }
    .fdw-proactive-teaser { right: 16px; bottom: 84px; width: min(320px, calc(100vw - 32px)); }
    .fdw-proactive-teaser.fdw-position-bottom-left { right: auto; left: 16px; }
    .fdw-panel, .fdw-panel.fdw-mode-expanded, .fdw-panel.fdw-mode-fullscreen { inset: 0; width: 100vw; height: 100dvh; max-height: none; border-radius: 0; }
    .fdw-header { min-height: 62px; }
    .fdw-messages { padding-top: 16px; }
  }
  @container fdw-preview (max-width: 640px) {
    .fdw-preview-root .fdw-launcher { right: 16px; bottom: 16px; }
    .fdw-preview-root .fdw-proactive-teaser { right: 16px; bottom: 84px; width: min(320px, calc(100% - 32px)); }
    .fdw-preview-root .fdw-proactive-teaser.fdw-position-bottom-left { right: auto; left: 16px; }
    .fdw-preview-root .fdw-panel, .fdw-preview-root .fdw-panel.fdw-mode-expanded, .fdw-preview-root .fdw-panel.fdw-mode-fullscreen { inset: 0; width: 100%; height: 100%; max-height: none; border-radius: 0; }
    .fdw-preview-root .fdw-header { min-height: 62px; }
    .fdw-preview-root .fdw-messages { padding-top: 16px; }
  }
`;
function isHexColor(value) {
    return /^#[\da-f]{6}$/i.test(value);
}
function accessibleTextColor(hex) {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.48 ? "#14233d" : "#ffffff";
}
function element(documentRef, tag, className) {
    const node = documentRef.createElement(tag);
    if (className)
        node.className = className;
    return node;
}
function renderFormControl(documentRef, field, valueOverride) {
    if (field.type === "select") {
        const select = element(documentRef, "select");
        select.name = field.key;
        const empty = element(documentRef, "option");
        empty.value = "";
        empty.textContent = "Select…";
        select.appendChild(empty);
        for (const optionValue of field.options ?? []) {
            const option = element(documentRef, "option");
            option.value = optionValue;
            option.textContent = optionValue;
            select.appendChild(option);
        }
        select.value = valueOverride ?? field.value ?? "";
        return select;
    }
    const input = element(documentRef, "input");
    input.type = field.type === "phone" ? "tel" : field.type;
    input.name = field.key;
    input.value = valueOverride ?? field.value ?? "";
    return input;
}
export function createWidgetRenderer(mount, options) {
    const documentRef = mount.ownerDocument;
    let config = { ...DEFAULT_CONFIG, ...options.config };
    let state = {
        isOpen: false,
        openedByUser: false,
        messages: [],
        quickActions: [],
        ...options.state,
    };
    let destroyed = false;
    const style = element(documentRef, "style");
    style.textContent = WIDGET_STYLES;
    const root = element(documentRef, "div", `fdw-widget-root fdw-${options.surface ?? "embed"}-root`);
    root.innerHTML = `
    <button class="fdw-launcher" aria-label="Open AI front desk" type="button">${SYMBOL}</button>
    <aside class="fdw-proactive-teaser" hidden aria-live="polite">
      <span class="fdw-teaser-mark">${SYMBOL}</span>
      <div class="fdw-teaser-copy"><p class="fdw-teaser-message"></p><button class="fdw-teaser-action" type="button">Ask me <span aria-hidden="true">→</span></button></div>
      <button class="fdw-teaser-dismiss" type="button" aria-label="Dismiss message">×</button>
    </aside>
    <section class="fdw-panel fdw-mode-compact" aria-label="AI front desk" aria-hidden="true">
      <header class="fdw-header">
        <div class="fdw-identity"><span class="fdw-orb">${SYMBOL}</span><div class="fdw-title-group"><strong class="fdw-title"></strong><small class="fdw-subtitle"><span class="fdw-status-dot" aria-hidden="true"></span><span class="fdw-subtitle-text"></span></small></div></div>
        <div class="fdw-header-actions"><button class="fdw-new-conversation" type="button" aria-label="Start new conversation" title="Start new conversation">＋</button><button class="fdw-expand" type="button" aria-label="Expand assistant" title="Expand assistant">↗</button><button class="fdw-close" type="button" aria-label="Close assistant" title="Close assistant">×</button></div>
      </header>
      <div class="fdw-system-status" role="status" aria-live="polite"><div class="fdw-system-status-copy"></div><div class="fdw-system-status-actions"></div></div>
      <div class="fdw-messages"></div>
      <div class="fdw-handoff-status" role="status" aria-live="polite"><div class="fdw-handoff-content"><span class="fdw-handoff-copy"></span><div class="fdw-handoff-actions" hidden><button class="fdw-handoff-continue" type="button">Continue conversation</button><button class="fdw-handoff-new" type="button">Ask a new question</button></div></div><button class="fdw-handoff-dismiss" type="button" aria-label="Dismiss notification" title="Dismiss notification">×</button></div>
      <div class="fdw-quick-actions"></div>
      <form class="fdw-action-form"></form>
      <form class="fdw-lead" hidden><div class="fdw-lead-heading"><strong>Let's get your details</strong><small>We’ll only use this to follow up on your question.</small></div><label><span>Name <b>*</b></span><input class="fdw-lead-name" name="name" type="text" autocomplete="name" placeholder="Your name" required></label><label><span>Email <b>*</b></span><input class="fdw-lead-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label><label><span>Phone <em>Optional</em></span><input class="fdw-lead-phone" name="phone" type="tel" autocomplete="tel" placeholder="(555) 555-0123"></label><label class="fdw-consent-row" hidden><input class="fdw-lead-consent" type="checkbox" name="consent"><span>I agree to share my details with this business. <a class="fdw-privacy-link" target="_blank" rel="noreferrer" hidden>Privacy notice</a></span></label><div class="fdw-consent-saved" hidden><span class="fdw-consent-saved-mark" aria-hidden="true">✓</span><span>Consent saved for this visit.</span></div><button type="submit">Continue</button></form>
      <form class="fdw-composer"><input placeholder="Ask a question…" aria-label="Ask a question"><button aria-label="Send" type="submit">➤</button></form>
      <div class="fdw-powered-by" aria-label="Powered by FrontDeskWise"><span class="fdw-powered-by-label">Powered by ${SYMBOL}<strong>FrontDeskWise</strong></span></div>
    </section>`;
    root.prepend(style);
    mount.replaceChildren(root);
    const launcher = root.querySelector(".fdw-launcher");
    const teaser = root.querySelector(".fdw-proactive-teaser");
    const teaserMessage = root.querySelector(".fdw-teaser-message");
    const panel = root.querySelector(".fdw-panel");
    const title = root.querySelector(".fdw-title");
    const subtitleText = root.querySelector(".fdw-subtitle-text");
    const statusDot = root.querySelector(".fdw-status-dot");
    const logoSlot = root.querySelector(".fdw-orb");
    const messages = root.querySelector(".fdw-messages");
    const systemStatus = root.querySelector(".fdw-system-status");
    const systemStatusCopy = root.querySelector(".fdw-system-status-copy");
    const systemStatusActions = root.querySelector(".fdw-system-status-actions");
    const quickActions = root.querySelector(".fdw-quick-actions");
    const actionForm = root.querySelector(".fdw-action-form");
    const lead = root.querySelector(".fdw-lead");
    const composer = root.querySelector(".fdw-composer");
    const composerInput = composer.querySelector("input");
    const handoffStatus = root.querySelector(".fdw-handoff-status");
    const handoffCopy = root.querySelector(".fdw-handoff-copy");
    const handoffActions = root.querySelector(".fdw-handoff-actions");
    const poweredBy = root.querySelector(".fdw-powered-by");
    const leadConsentRow = root.querySelector(".fdw-consent-row");
    const leadConsentSaved = root.querySelector(".fdw-consent-saved");
    const privacyLink = root.querySelector(".fdw-privacy-link");
    function renderLogo() {
        const logoUrl = config.widgetLogoUrl?.trim();
        if (!logoUrl) {
            logoSlot.innerHTML = SYMBOL;
            return;
        }
        const image = element(documentRef, "img", "fdw-logo");
        image.src = logoUrl;
        image.alt = "";
        image.addEventListener("error", () => { logoSlot.innerHTML = SYMBOL; });
        logoSlot.replaceChildren(image);
    }
    function renderMessages() {
        messages.replaceChildren();
        for (const message of state.messages) {
            const item = element(documentRef, "div", `fdw-message${message.role === "user" ? " fdw-user" : ""}${message.status === "failed" ? " fdw-message-failed" : ""}`);
            if (message.role === "assistant")
                renderMarkdownInto(documentRef, item, message.content);
            else
                item.textContent = message.content;
            if (message.role === "assistant" && config.showSources !== false) {
                const citation = message.citations?.find((candidate) => candidate?.url);
                if (citation?.url) {
                    const link = element(documentRef, "a");
                    const safeUrl = safeLinkUrl(citation.url);
                    if (safeUrl) {
                        link.href = safeUrl;
                        link.target = "_blank";
                        link.rel = "noopener noreferrer";
                        link.textContent = "View source ↗";
                        item.appendChild(link);
                    }
                }
            }
            if (message.status && message.role === "user") {
                const meta = element(documentRef, "div", "fdw-message-meta");
                meta.textContent = message.status === "sending" ? "Sending…" : message.status === "failed" ? "⚠ Not sent" : "";
                if (message.status === "failed" && message.retryable) {
                    const retry = element(documentRef, "button", "fdw-message-retry");
                    retry.type = "button";
                    retry.textContent = "Retry";
                    retry.addEventListener("click", () => options.onRetryMessage?.(message));
                    meta.appendChild(retry);
                }
                if (meta.textContent || message.status === "failed")
                    item.appendChild(meta);
            }
            messages.appendChild(item);
        }
        if (state.typing) {
            const typing = element(documentRef, "div", "fdw-typing");
            typing.setAttribute("role", "status");
            typing.setAttribute("aria-label", state.typingMessage || "Assistant is typing");
            typing.innerHTML = `<span></span><span></span><span></span>${state.typingMessage ? `<small>${state.typingMessage}</small>` : ""}`;
            messages.appendChild(typing);
        }
        messages.scrollTop = messages.scrollHeight;
    }
    function renderQuickActions() {
        quickActions.replaceChildren();
        const primaryCta = state.primaryCta;
        if (primaryCta?.label) {
            if (primaryCta.url) {
                const link = element(documentRef, "a", "fdw-primary-cta");
                const safeUrl = safeLinkUrl(primaryCta.url);
                if (safeUrl) {
                    link.href = safeUrl;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = primaryCta.label;
                    link.setAttribute("aria-label", `${primaryCta.label} (opens in a new tab)`);
                    link.addEventListener("click", () => options.onPrimaryCtaClick?.(primaryCta));
                    quickActions.appendChild(link);
                }
            }
            else {
                const button = element(documentRef, "button", "fdw-primary-cta");
                button.type = "button";
                button.textContent = primaryCta.label;
                button.addEventListener("click", () => {
                    options.onPrimaryCtaClick?.(primaryCta);
                    if (primaryCta.question)
                        options.onAsk?.(primaryCta.question);
                });
                quickActions.appendChild(button);
            }
        }
        for (const action of state.quickActions.slice(0, 4)) {
            if (!action?.label)
                continue;
            const button = element(documentRef, "button");
            button.type = "button";
            button.textContent = action.label;
            button.addEventListener("click", () => {
                if (action.question) {
                    composerInput.value = "";
                    options.onAsk?.(action.question);
                }
                else
                    composerInput.focus();
            });
            quickActions.appendChild(button);
        }
    }
    function renderActionForm() {
        actionForm.replaceChildren();
        const action = state.action;
        if (!action || action.status === "completed") {
            actionForm.hidden = true;
            const safeActionUrl = action?.linkUrl ? safeLinkUrl(action.linkUrl) : null;
            if (safeActionUrl) {
                const link = element(documentRef, "a");
                link.href = safeActionUrl;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                const linkLabel = action?.linkLabel || "Continue";
                link.textContent = linkLabel;
                link.setAttribute("aria-label", `${linkLabel} (opens in a new tab)`);
                link.className = "fdw-action-link";
                actionForm.appendChild(link);
                actionForm.hidden = false;
            }
            return;
        }
        if (!action.form?.fields?.length) {
            actionForm.hidden = true;
            return;
        }
        for (const field of action.form.fields) {
            const label = element(documentRef, "label");
            const labelText = element(documentRef, "span");
            labelText.textContent = field.label;
            if (field.required) {
                const required = element(documentRef, "b");
                required.textContent = " *";
                labelText.appendChild(required);
            }
            else {
                const optional = element(documentRef, "em");
                optional.textContent = "Optional";
                labelText.appendChild(optional);
            }
            label.appendChild(labelText);
            const control = renderFormControl(documentRef, field, state.actionValues?.[field.key]);
            control.required = Boolean(field.required);
            label.appendChild(control);
            actionForm.appendChild(label);
        }
        if (config.requireLeadConsent) {
            if (state.consentGiven) {
                const saved = element(documentRef, "div", "fdw-consent-saved");
                const mark = element(documentRef, "span", "fdw-consent-saved-mark");
                mark.setAttribute("aria-hidden", "true");
                mark.textContent = "✓";
                const copy = element(documentRef, "span");
                copy.textContent = "Consent saved for this visit.";
                saved.append(mark, copy);
                actionForm.appendChild(saved);
            }
            else {
                const consent = element(documentRef, "label", "fdw-consent-row");
                consent.innerHTML = "<input type=\"checkbox\" name=\"consent\" required><span>I agree to share my details with this business.</span>";
                const consentInput = consent.querySelector("input");
                if (consentInput)
                    consentInput.checked = state.actionValues?.consent === "true" || state.actionValues?.consent === "on";
                actionForm.appendChild(consent);
            }
        }
        if (state.actionError) {
            const error = element(documentRef, "div", "fdw-action-error");
            error.textContent = state.actionError;
            actionForm.appendChild(error);
        }
        const submit = element(documentRef, "button");
        submit.type = "submit";
        submit.disabled = Boolean(state.actionSubmitting);
        submit.textContent = state.actionSubmitting ? "Submitting…" : action.form.submitLabel || "Continue";
        actionForm.appendChild(submit);
        actionForm.hidden = false;
    }
    function renderHandoff() {
        const status = state.handoffStatus;
        const waiting = status === "WAITING_FOR_STAFF" || status === "HANDOFF_REQUESTED";
        const inactive = status === "RESOLVED" || status === "EXPIRED";
        statusDot.classList.toggle("fdw-status-dot-waiting", waiting);
        statusDot.classList.toggle("fdw-status-dot-inactive", inactive);
        if (waiting)
            subtitleText.textContent = "Waiting for a team member";
        else if (status === "HUMAN_ACTIVE")
            subtitleText.textContent = "Team member joined";
        else if (status === "RESOLVED")
            subtitleText.textContent = "Conversation resolved";
        else if (status === "EXPIRED")
            subtitleText.textContent = "Starting a fresh conversation";
        else
            subtitleText.textContent = config.showAiDisclosure === false ? "Here to help" : "AI assistant online";
        const notice = state.handoffNotice;
        handoffCopy.textContent = notice?.message ?? "";
        handoffActions.hidden = notice?.choice !== true;
        handoffStatus.classList.toggle("fdw-visible", Boolean(notice?.visible));
    }
    function renderSystemStatus() {
        const status = state.statusMessage?.trim() || "";
        const offline = state.connectionState === "offline" || state.connectionState === "reconnecting";
        const visible = Boolean(status || offline);
        systemStatus.classList.toggle("fdw-visible", visible);
        systemStatus.classList.toggle("fdw-warning", offline || state.healthState === "DEGRADED" || state.healthState === "HANDOFF_DEGRADED");
        systemStatus.classList.toggle("fdw-error", state.healthState === "CONFIG_ERROR" || state.healthState === "MESSAGE_FAILED" || state.healthState === "ACTION_FAILED" || state.healthState === "TEMPORARY_ERROR");
        systemStatusCopy.textContent = offline ? (state.connectionState === "reconnecting" ? "Connection lost — trying to reconnect…" : "Connection lost — you can keep typing and we’ll retry when you’re back online.") : status;
        systemStatusActions.replaceChildren();
        if (state.statusMessage && state.healthState !== "OFFLINE") {
            const retry = element(documentRef, "button");
            retry.type = "button";
            retry.textContent = state.statusAction === "new_conversation" ? "Start new conversation" : "Try again";
            retry.addEventListener("click", () => {
                if (state.healthState === "CONFIG_ERROR")
                    options.onRetryConfig?.();
                else if (state.statusAction === "new_conversation")
                    options.onNewConversation?.();
                else {
                    const message = [...state.messages].reverse().find((candidate) => candidate.role === "user" && (candidate.status === "failed" || state.statusAction === "retry"));
                    if (message)
                        options.onRetryMessage?.(message);
                }
            });
            systemStatusActions.appendChild(retry);
        }
        const contacts = state.statusContacts || config.fallbackContacts;
        const addContact = (label, href) => {
            const link = element(documentRef, "a");
            link.href = href;
            link.textContent = label;
            if (href.startsWith("http")) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }
            systemStatusActions.appendChild(link);
        };
        if (contacts?.phone)
            addContact("Call", `tel:${contacts.phone}`);
        if (contacts?.email)
            addContact("Email", `mailto:${contacts.email}`);
        if (contacts?.url)
            addContact("Contact the team", contacts.url);
    }
    function render() {
        if (destroyed)
            return;
        const accent = isHexColor(config.widgetColor) ? config.widgetColor : DEFAULT_ACCENT;
        root.style.setProperty("--fdw-accent", accent);
        root.style.setProperty("--fdw-accent-text", accessibleTextColor(accent));
        launcher.classList.toggle("fdw-position-bottom-left", config.widgetPosition === "bottom-left");
        teaser.classList.toggle("fdw-position-bottom-left", config.widgetPosition === "bottom-left");
        panel.className = `fdw-panel fdw-theme-${config.widgetTheme || "auto"} fdw-position-${config.widgetPosition || "bottom-right"} fdw-mode-${config.widgetDefaultMode || "compact"}${state.isOpen ? " fdw-open" : ""}`;
        panel.setAttribute("aria-hidden", String(!state.isOpen));
        launcher.hidden = state.isOpen;
        title.textContent = config.assistantName || "AI front desk";
        renderLogo();
        root.querySelector(".fdw-expand").hidden = config.widgetAllowExpand === false;
        const consentRemembered = config.requireLeadConsent === true && state.consentGiven === true;
        leadConsentRow.hidden = config.requireLeadConsent !== true || consentRemembered;
        leadConsentSaved.hidden = !consentRemembered;
        const safePrivacyUrl = config.privacyNoticeUrl ? safeLinkUrl(config.privacyNoticeUrl) : null;
        if (safePrivacyUrl) {
            privacyLink.href = safePrivacyUrl;
            privacyLink.hidden = false;
        }
        else
            privacyLink.hidden = true;
        poweredBy.hidden = config.showPoweredBy === false;
        teaser.hidden = !state.proactive?.visible;
        teaserMessage.textContent = state.proactive?.message ?? "";
        renderHandoff();
        renderSystemStatus();
        renderMessages();
        renderQuickActions();
        renderActionForm();
        lead.hidden = !(state.leadVisible && config.showLeadCapture !== false);
        lead.classList.toggle("fdw-visible", state.leadVisible === true && config.showLeadCapture !== false);
        const submit = lead.querySelector("button[type=submit]");
        if (submit) {
            submit.disabled = Boolean(state.leadSubmitting);
            submit.textContent = state.leadSubmitting ? "Sending…" : "Continue";
        }
    }
    function collectActionValues() {
        const values = {};
        for (const field of Array.from(actionForm.elements)) {
            const control = field;
            if (control.name)
                values[control.name] = control.type === "checkbox" ? String(control.checked) : control.value;
        }
        if (config.requireLeadConsent && state.consentGiven)
            values.consent = "true";
        return values;
    }
    function rememberActionValues() {
        const action = state.action;
        if (!action)
            return;
        const values = collectActionValues();
        if (!Object.keys(values).length)
            return;
        state = { ...state, actionValues: { ...(state.actionValues || {}), ...values } };
        options.onActionValuesChange?.(state.actionValues || {}, action);
    }
    const open = (source = "launcher", userInitiated = true) => {
        if (destroyed)
            return;
        state = { ...state, isOpen: true, openedByUser: state.openedByUser || userInitiated, proactive: { ...(state.proactive ?? { visible: false, message: "" }), visible: false } };
        render();
        options.onOpen?.(source, userInitiated);
    };
    const close = () => {
        if (destroyed)
            return;
        state = { ...state, isOpen: false, openedByUser: false };
        render();
        options.onClose?.();
    };
    launcher.addEventListener("click", () => open("launcher"));
    root.querySelector(".fdw-teaser-action").addEventListener("click", () => open("proactive"));
    root.querySelector(".fdw-teaser-dismiss").addEventListener("click", () => {
        state = { ...state, proactive: { ...(state.proactive ?? { visible: false, message: "" }), visible: false } };
        render();
        options.onProactiveDismiss?.();
    });
    root.querySelector(".fdw-close").addEventListener("click", close);
    root.querySelector(".fdw-new-conversation").addEventListener("click", () => options.onNewConversation?.());
    root.querySelector(".fdw-expand").addEventListener("click", () => {
        if (!config.widgetAllowExpand)
            return;
        config = { ...config, widgetDefaultMode: config.widgetDefaultMode === "compact" ? "expanded" : "compact" };
        render();
    });
    root.querySelector(".fdw-handoff-dismiss").addEventListener("click", () => options.onHandoffDismiss?.());
    root.querySelector(".fdw-handoff-continue").addEventListener("click", () => options.onHandoffContinue?.());
    root.querySelector(".fdw-handoff-new").addEventListener("click", () => options.onNewConversation?.());
    composer.addEventListener("submit", (event) => {
        event.preventDefault();
        const question = composerInput.value.trim();
        if (!question)
            return;
        composerInput.value = "";
        options.onAsk?.(question);
    });
    actionForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!state.action)
            return;
        rememberActionValues();
        const values = collectActionValues();
        options.onActionSubmit?.(values, state.action);
    });
    actionForm.addEventListener("input", rememberActionValues);
    actionForm.addEventListener("change", rememberActionValues);
    actionForm.addEventListener("focusin", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement))
            return;
        window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    });
    actionForm.addEventListener("change", (event) => {
        const control = event.target;
        if (control?.type === "checkbox" && control.name === "consent") {
            state = { ...state, consentGiven: control.checked };
            options.onConsentChange?.(control.checked);
        }
    });
    lead.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(lead);
        options.onLeadSubmit?.({
            name: String(formData.get("name") ?? "").trim(),
            email: String(formData.get("email") ?? "").trim(),
            phone: String(formData.get("phone") ?? "").trim(),
            consent: state.consentGiven === true || formData.get("consent") === "on",
        });
    });
    lead.addEventListener("change", (event) => {
        const control = event.target;
        if (control?.type === "checkbox" && control.name === "consent") {
            state = { ...state, consentGiven: control.checked };
            options.onConsentChange?.(control.checked);
        }
    });
    render();
    return {
        update(patch) {
            if (patch.config)
                config = { ...config, ...patch.config };
            if (patch.state) {
                if (state.isOpen && patch.state.isOpen === false) {
                    const { isOpen: _ignoredIsOpen, ...safeState } = patch.state;
                    state = { ...state, ...safeState, isOpen: true };
                }
                else {
                    state = { ...state, ...patch.state };
                }
            }
            render();
        },
        open,
        close,
        destroy() {
            destroyed = true;
            mount.replaceChildren();
        },
    };
}
