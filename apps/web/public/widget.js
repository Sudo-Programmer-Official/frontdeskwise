(function () {
  "use strict";

  var script = document.currentScript;
  if (!script || !script.dataset.site) return;

  var siteKey = script.dataset.site;
  var apiBase = (script.dataset.api || new URL(script.src, window.location.href).origin).replace(/\/$/, "");
  var host = document.createElement("div");
  host.setAttribute("data-frontdeskwise-widget", siteKey);
  (document.body || document.documentElement).appendChild(host);
  var shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
      .launcher { position: fixed; right: 22px; bottom: 22px; z-index: 2147483000; display: grid; place-items: center; width: 58px; height: 58px; border: 0; border-radius: 18px; color: #fff; background: var(--accent, #0d6efd); box-shadow: 0 14px 30px rgba(13, 75, 160, .28); cursor: pointer; font-size: 24px; transition: transform .18s ease, box-shadow .18s ease; }
      .launcher:hover { transform: translateY(-2px); box-shadow: 0 18px 34px rgba(13, 75, 160, .34); }
      .launcher[hidden] { display: none; }
      .panel { position: fixed; right: 22px; bottom: 92px; z-index: 2147483000; display: none; flex-direction: column; width: min(420px, calc(100vw - 32px)); height: min(680px, calc(100vh - 120px)); overflow: hidden; border: 1px solid #d7e1ee; border-radius: 18px; color: #182b49; background: #fff; box-shadow: 0 24px 70px rgba(13, 44, 91, .24); }
      .panel.open { display: flex; }
      .panel.mode-expanded { width: min(760px, calc(100vw - 48px)); height: min(760px, calc(100vh - 48px)); }
      .panel.mode-fullscreen { right: 0; bottom: 0; width: min(920px, 100vw); height: 100dvh; border-radius: 0; }
      .launcher.position-bottom-left { right: auto; left: 22px; }
      .panel.position-bottom-left { right: auto; left: 22px; }
      .panel.theme-dark { color: #eef5ff; background: #182a43; border-color: #2f4768; }
      .panel.theme-dark .messages, .panel.theme-dark .quick-actions { background: #122238; }
      .panel.theme-dark .message { color: #e4edf9; background: #243b5c; border-color: #385578; }
      .panel.theme-dark .composer { background: #182a43; border-color: #2f4768; }
      .panel.theme-dark .composer input { color: #eef5ff; background: #243b5c; border-color: #385578; }
      @media (prefers-color-scheme: dark) {
        .panel.theme-auto { color: #eef5ff; background: #182a43; border-color: #2f4768; }
        .panel.theme-auto .messages, .panel.theme-auto .quick-actions { background: #122238; }
        .panel.theme-auto .message { color: #e4edf9; background: #243b5c; border-color: #385578; }
        .panel.theme-auto .composer { background: #182a43; border-color: #2f4768; }
        .panel.theme-auto .composer input { color: #eef5ff; background: #243b5c; border-color: #385578; }
      }
      .header { display: flex; align-items: center; gap: 10px; min-height: 66px; padding: 13px 15px; color: #fff; background: var(--accent, #0d6efd); }
      .identity { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
      .logo, .orb { display: grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,.2); }
      .logo { object-fit: cover; background: #fff; }
      .title-group { display: grid; gap: 2px; min-width: 0; }
      .title-group strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; letter-spacing: -.01em; }
      .title-group small { color: rgba(255,255,255,.76); font-size: 10px; }
      .handoff-status { display: none; margin: 0 15px 10px; padding: 9px 11px; border: 1px solid #cfe0f7; border-radius: 9px; color: #36577e; background: #f3f8ff; font-size: 11px; line-height: 1.4; }
      .handoff-status.open { display: block; }
      .header-actions { display: flex; gap: 4px; }
      .header-actions button { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px; color: #fff; background: transparent; cursor: pointer; font-size: 17px; }
      .header-actions button:hover, .header-actions button:focus-visible { background: rgba(255,255,255,.16); outline: none; }
      .messages { display: flex; flex: 1; flex-direction: column; align-content: flex-start; gap: 10px; min-height: 0; overflow: auto; padding: 18px 16px 12px; background: #f8fafd; }
      .message { align-self: flex-start; max-width: min(88%, 560px); padding: 11px 12px; border: 1px solid #e1e9f3; border-radius: 6px 14px 14px 14px; color: #445873; background: #fff; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
      .message.user { align-self: flex-end; border-color: var(--accent, #0d6efd); border-radius: 14px 6px 14px 14px; color: #fff; background: var(--accent, #0d6efd); }
      .message a { display: block; margin-top: 8px; color: #1769c2; font-size: 11px; font-weight: 800; }
      .message.user a { color: #fff; }
      .quick-actions { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 16px 13px; background: #f8fafd; }
      .quick-actions[hidden] { display: none; }
      .quick-actions button { padding: 8px 10px; border: 1px solid #bfd4ed; border-radius: 999px; color: #20558e; background: #fff; cursor: pointer; font-size: 11px; font-weight: 750; }
      .quick-actions button:hover, .quick-actions button:focus-visible { border-color: var(--accent, #0d6efd); color: var(--accent, #0d6efd); outline: none; }
      .action-form { display: grid; gap: 8px; margin: 0 15px 13px; padding: 12px; border: 1px solid #dbe7f8; border-radius: 11px; background: #f7faff; }
      .action-form[hidden] { display: none; }
      .action-form label { display: grid; gap: 4px; color: #5e708a; font-size: 10px; font-weight: 750; }
      .action-form input, .action-form select { width: 100%; padding: 9px; border: 1px solid #dbe4ef; border-radius: 8px; outline: none; color: #243957; background: #fff; font-size: 11px; }
      .action-form input:focus, .action-form select:focus, .lead input:focus, .composer input:focus { border-color: var(--accent, #0d6efd); box-shadow: 0 0 0 3px rgba(13,110,253,.12); }
      .action-form button { padding: 10px; border: 0; border-radius: 8px; color: #fff; background: var(--accent, #0d6efd); cursor: pointer; font-size: 11px; font-weight: 800; }
      .lead { display: none; gap: 7px; padding: 0 15px 13px; }
      .lead.open { display: grid; }
      .lead small { color: #687b94; font-size: 11px; }
      .lead input { padding: 9px; border: 1px solid #dbe4ef; border-radius: 8px; outline: none; font-size: 11px; }
      .consent-row { display: flex; gap: 7px; align-items: flex-start; color: #687b94; font-size: 10px; font-weight: 500; line-height: 1.4; }
      .consent-row[hidden] { display: none; }
      .consent-row input { flex: 0 0 auto; margin: 1px 0 0; accent-color: var(--accent, #0d6efd); }
      .consent-row a { color: #1769c2; font-weight: 700; }
      .lead button { padding: 9px; border: 0; border-radius: 8px; color: #fff; background: var(--accent, #0d6efd); cursor: pointer; font-size: 11px; font-weight: 800; }
      .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e6edf5; background: #fff; }
      .composer input { min-width: 0; flex: 1; padding: 11px 12px; border: 1px solid #d5e0ed; border-radius: 9px; outline: none; color: #243957; font-size: 12px; }
      .composer button { width: 40px; border: 0; border-radius: 9px; color: #fff; background: var(--accent, #0d6efd); cursor: pointer; font-size: 15px; font-weight: 800; }
      @media (max-width: 640px) {
        .launcher { right: 16px; bottom: 16px; }
        .panel, .panel.mode-expanded, .panel.mode-fullscreen { inset: 0; width: 100vw; height: 100dvh; max-height: none; border-radius: 0; }
        .header { min-height: 62px; }
        .messages { padding-top: 16px; }
      }
    </style>
    <button class="launcher" aria-label="Open AI front desk">✦</button>
    <section class="panel mode-compact" aria-label="AI front desk" aria-hidden="true">
      <header class="header">
        <div class="identity"><span class="orb">✦</span><div class="title-group"><strong class="title">AI front desk</strong><small class="subtitle">Usually replies in a few seconds</small></div></div>
        <div class="header-actions"><button class="expand" type="button" aria-label="Expand assistant" title="Expand assistant">↗</button><button class="close" type="button" aria-label="Close assistant" title="Close assistant">×</button></div>
      </header>
      <div class="messages"></div>
      <div class="handoff-status"></div>
      <div class="quick-actions" hidden></div>
      <form class="action-form" hidden></form>
      <div class="lead"><small>Want a team member to follow up?</small><input type="email" placeholder="Your email" aria-label="Your email"/><label class="consent-row" hidden><input class="lead-consent" type="checkbox" name="consent"/><span>I agree to share my details with this business. <a class="privacy-link" target="_blank" rel="noreferrer" hidden>Privacy notice</a></span></label><button type="button">Send details</button></div>
      <form class="composer"><input placeholder="Ask a question…" aria-label="Ask a question"/><button aria-label="Send" type="submit">➤</button></form>
    </section>`;

  var launcher = shadow.querySelector(".launcher");
  var panel = shadow.querySelector(".panel");
  var close = shadow.querySelector(".close");
  var expand = shadow.querySelector(".expand");
  var title = shadow.querySelector(".title");
  var subtitle = shadow.querySelector(".subtitle");
  var handoffStatus = shadow.querySelector(".handoff-status");
  var logoSlot = shadow.querySelector(".orb");
  var messages = shadow.querySelector(".messages");
  var quickActions = shadow.querySelector(".quick-actions");
  var composer = shadow.querySelector(".composer");
  var input = composer.querySelector("input");
  var actionForm = shadow.querySelector(".action-form");
  var lead = shadow.querySelector(".lead");
  var leadInput = lead.querySelector("input");
  var leadConsentRow = shadow.querySelector(".consent-row");
  var leadConsent = shadow.querySelector(".lead-consent");
  var privacyLink = shadow.querySelector(".privacy-link");
  var conversationId = null;
  var lastQuestion = "";
  var config = null;
  var activeAction = null;
  var actionSubmitting = false;
  var pollTimer = null;
  var renderedRemoteMessages = {};
  var mode = "compact";
  var lastViewedField = null;
  var visitorId = getVisitorId();
  var proactiveTimer = null;
  var proactiveShown = false;

  function getVisitorId() {
    var key = "frontdeskwise:visitor:" + siteKey;
    try {
      var stored = window.localStorage.getItem(key);
      if (stored) return stored;
      var generated = "visitor-" + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
      window.localStorage.setItem(key, generated);
      return generated;
    } catch (_) {
      return "visitor-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }
  }

  function deviceType() {
    var width = window.innerWidth || 1024;
    return width < 640 ? "mobile" : width < 1024 ? "tablet" : "desktop";
  }

  function telemetry(event, extra) {
    var payload = Object.assign({
      event: event,
      conversationId: conversationId,
      sourcePage: window.location.href,
      device: deviceType(),
      timestamp: new Date().toISOString()
    }, extra || {});
    fetch(apiBase + "/api/v1/widget/" + encodeURIComponent(siteKey) + "/telemetry", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () { /* Telemetry must never interrupt the visitor flow. */ });
  }

  function setMode(nextMode) {
    mode = nextMode === "expanded" || nextMode === "fullscreen" ? nextMode : "compact";
    panel.classList.remove("mode-compact", "mode-expanded", "mode-fullscreen");
    panel.classList.add("mode-" + mode);
    var expanded = mode !== "compact";
    expand.textContent = expanded ? "↙" : "↗";
    expand.setAttribute("aria-label", expanded ? "Collapse assistant" : "Expand assistant");
    expand.title = expanded ? "Collapse assistant" : "Expand assistant";
  }

  function addMessage(text, user, citation, remoteKey) {
    if (remoteKey && renderedRemoteMessages[remoteKey]) return;
    if (remoteKey) renderedRemoteMessages[remoteKey] = true;
    var item = document.createElement("div");
    item.className = "message" + (user ? " user" : "");
    item.textContent = text;
    if (citation && citation.url) {
      var link = document.createElement("a");
      link.href = citation.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "View source ↗";
      item.appendChild(link);
    }
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderConversationStatus(status) {
    if (status === "WAITING_FOR_STAFF" || status === "HANDOFF_REQUESTED") {
      handoffStatus.textContent = "A team member has been notified and will join this conversation shortly.";
      handoffStatus.classList.add("open");
      subtitle.textContent = "Waiting for a team member";
      return;
    }
    if (status === "HUMAN_ACTIVE" || status === "AI_ASSISTED") {
      handoffStatus.textContent = "You’re connected with the team. You can keep sending messages here.";
      handoffStatus.classList.add("open");
      subtitle.textContent = "Connected to the team";
      return;
    }
    if (status === "RESOLVED") {
      handoffStatus.textContent = "This conversation is resolved. Start a new message if you need anything else.";
      handoffStatus.classList.add("open");
      subtitle.textContent = "Conversation resolved";
      return;
    }
    handoffStatus.classList.remove("open");
    subtitle.textContent = config && config.agent && config.agent.showAiDisclosure === false ? "Here to help" : "AI assistant · Usually replies in a few seconds";
  }

  async function syncConversation() {
    if (!conversationId) return;
    try {
      var payload = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations/" + encodeURIComponent(conversationId));
      renderConversationStatus(payload.conversation && payload.conversation.status);
      (payload.messages || []).forEach(function (message) {
        if (message.role !== "human" && message.role !== "system") return;
        var key = String(message.createdAt || "") + ":" + String(message.role || "") + ":" + String(message.content || "");
        addMessage(message.content || "", false, null, key);
      });
    } catch (_) {
      // Polling is best-effort; the visitor can continue using the assistant.
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(syncConversation, 5000);
  }

  function renderQuickActions(actions) {
    quickActions.innerHTML = "";
    (actions || []).slice(0, 4).forEach(function (action) {
      if (!action || !action.label) return;
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", function () {
        if (action.question) ask(action.question);
        else input.focus();
      });
      quickActions.appendChild(button);
    });
    quickActions.hidden = !quickActions.children.length;
  }

  function renderActionForm(action) {
    activeAction = action || null;
    lastViewedField = null;
    actionForm.innerHTML = "";
    if (!action || !action.form || !action.form.fields || !action.form.fields.length || action.status === "completed") {
      actionForm.hidden = true;
      if (action && action.linkUrl) {
        var link = document.createElement("a");
        link.href = action.linkUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = action.linkLabel || "Continue";
        link.style.display = "block";
        link.style.padding = "10px";
        link.style.color = "#fff";
        link.style.background = "var(--accent, #0d6efd)";
        link.style.borderRadius = "8px";
        link.style.textAlign = "center";
        link.style.textDecoration = "none";
        actionForm.appendChild(link);
        actionForm.hidden = false;
        link.addEventListener("click", function () { telemetry("BOOKING_LINK_OPENED", { flowId: action.id, metadata: { url: action.linkUrl } }); });
      }
      return;
    }
    action.form.fields.forEach(function (field) {
      var label = document.createElement("label");
      label.textContent = field.label + (field.required ? "" : " (optional)");
      var control;
      if (field.type === "select") {
        control = document.createElement("select");
        var empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Select…";
        control.appendChild(empty);
        (field.options || []).forEach(function (option) {
          var item = document.createElement("option");
          item.value = option;
          item.textContent = option;
          control.appendChild(item);
        });
      } else {
        control = document.createElement("input");
        control.type = field.type === "phone" ? "tel" : field.type;
      }
      control.name = field.key;
      control.required = Boolean(field.required);
      control.value = field.value || "";
      control.addEventListener("focus", function () {
        lastViewedField = field.key;
        telemetry("FIELD_VIEWED", { flowId: action.id, fieldId: field.key });
      });
      label.appendChild(control);
      actionForm.appendChild(label);
    });
    if (config && config.agent && config.agent.requireLeadConsent) {
      var consentLabel = document.createElement("label");
      consentLabel.className = "consent-row";
      var consent = document.createElement("input");
      consent.type = "checkbox";
      consent.name = "consent";
      consent.required = true;
      var consentText = document.createElement("span");
      consentText.textContent = "I agree to share my details with this business.";
      consentLabel.appendChild(consent);
      consentLabel.appendChild(consentText);
      actionForm.appendChild(consentLabel);
    }
    var submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = action.form.submitLabel || "Continue";
    actionForm.appendChild(submit);
    actionForm.hidden = false;
  }

  async function api(path, options) {
    var response = await fetch(apiBase + path, Object.assign({ headers: { "content-type": "application/json" } }, options || {}));
    var payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The front desk is unavailable.");
    return payload;
  }

  async function loadConfig() {
    var payload = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/config");
    config = payload;
    var agent = payload.agent || {};
    panel.style.setProperty("--accent", agent.widgetColor || "#0d6efd");
    launcher.style.setProperty("--accent", agent.widgetColor || "#0d6efd");
    panel.classList.remove("theme-light", "theme-dark", "theme-auto", "position-bottom-right", "position-bottom-left");
    launcher.classList.remove("position-bottom-right", "position-bottom-left");
    panel.classList.add("theme-" + (agent.widgetTheme || "auto"), "position-" + (agent.widgetPosition || "bottom-right"));
    launcher.classList.add("position-" + (agent.widgetPosition || "bottom-right"));
    title.textContent = agent.assistantName || "AI front desk";
    if (agent.widgetLogoUrl) {
      var image = document.createElement("img");
      image.className = "logo";
      image.src = agent.widgetLogoUrl;
      image.alt = "";
      var fallbackLogo = logoSlot;
      image.addEventListener("error", function () { image.replaceWith(fallbackLogo); logoSlot = fallbackLogo; });
      logoSlot.replaceWith(image);
      logoSlot = image;
    }
    if (agent.widgetAllowExpand === false) expand.hidden = true;
    subtitle.textContent = agent.showAiDisclosure === false ? "Here to help" : "AI assistant · Usually replies in a few seconds";
    leadConsentRow.hidden = agent.requireLeadConsent !== true;
    if (agent.privacyNoticeUrl) {
      privacyLink.href = agent.privacyNoticeUrl;
      privacyLink.hidden = false;
    }
    mode = agent.widgetDefaultMode || "compact";
    setMode(mode);
    addMessage(agent.welcomeMessage || "Hi! How can I help?", false);
    renderQuickActions(agent.widgetQuickActions);
    armProactiveEngagement(agent);
  }

  function showProactivePrompt() {
    if (proactiveShown || !config || !config.agent || !config.agent.proactiveEnabled || panel.classList.contains("open")) return;
    proactiveShown = true;
    try { window.sessionStorage.setItem("frontdeskwise:proactive:" + siteKey, "1"); } catch (_) { /* Best effort. */ }
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    launcher.hidden = true;
    addMessage(config.agent.proactiveMessage || "Looking for the right service? I can help.", false);
    telemetry("CTA_CLICKED", { metadata: { source: "proactive" } });
  }

  function armProactiveEngagement(agent) {
    if (!agent.proactiveEnabled || proactiveShown) return;
    try {
      if (window.sessionStorage.getItem("frontdeskwise:proactive:" + siteKey)) {
        proactiveShown = true;
        return;
      }
    } catch (_) { /* Best effort. */ }
    var triggers = Array.isArray(agent.proactiveTriggers) ? agent.proactiveTriggers : [];
    var oneShot = function () { showProactivePrompt(); };
    if (triggers.indexOf("delay") >= 0) proactiveTimer = window.setTimeout(oneShot, Number(agent.proactiveDelaySeconds || 20) * 1000);
    if (triggers.indexOf("returning") >= 0) {
      try {
        if (window.localStorage.getItem("frontdeskwise:visited:" + siteKey)) window.setTimeout(oneShot, 900);
        window.localStorage.setItem("frontdeskwise:visited:" + siteKey, "1");
      } catch (_) { /* Best effort. */ }
    }
    if (triggers.indexOf("scroll") >= 0) {
      var onScroll = function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && window.scrollY / max >= .7) { window.removeEventListener("scroll", onScroll); oneShot(); }
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    if (triggers.indexOf("exit") >= 0 && deviceType() === "desktop") {
      var onExit = function (event) {
        if (event.clientY <= 0) { document.removeEventListener("mouseout", onExit); oneShot(); }
      };
      document.addEventListener("mouseout", onExit);
    }
  }

  async function ask(question) {
    if (!question) return;
    quickActions.hidden = true;
    lastQuestion = question;
    input.value = "";
    try {
      if (!conversationId) {
        var started = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations", { method: "POST", body: JSON.stringify({ sessionId: visitorId }) });
        conversationId = started.conversationId;
        if (started.resumed) {
          var history = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations/" + encodeURIComponent(conversationId));
          (history.messages || []).forEach(function (message) { addMessage(message.content || "", message.role === "user", message.citations && message.citations[0], String(message.createdAt || "") + ":history"); });
          renderConversationStatus(history.conversation && history.conversation.status);
        }
      }
      addMessage(question, true);
      var answer = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations/" + encodeURIComponent(conversationId) + "/messages", { method: "POST", body: JSON.stringify({ question: question }) });
      addMessage(answer.answer, false, answer.citations && answer.citations[0]);
      renderConversationStatus(answer.conversation && answer.conversation.status);
      if (answer.conversation && answer.conversation.status !== "AI_ACTIVE") startPolling();
      renderActionForm(answer.action);
      if (answer.action) lead.classList.remove("open");
      if (!answer.grounded && !answer.action) lead.classList.add("open");
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "The front desk is unavailable.", false);
    }
  }

  launcher.addEventListener("click", function () {
    proactiveShown = true;
    if (proactiveTimer) window.clearTimeout(proactiveTimer);
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    launcher.hidden = true;
    telemetry("CTA_CLICKED", { metadata: { source: "launcher" } });
    if (!config) loadConfig().catch(function (error) { addMessage(error.message, false); });
  });
  close.addEventListener("click", function () {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    launcher.hidden = false;
  });
  expand.addEventListener("click", function () {
    if (expand.hidden) return;
    setMode(mode === "compact" ? "expanded" : "compact");
  });
  composer.addEventListener("submit", function (event) { event.preventDefault(); var question = input.value.trim(); if (question) ask(question); });
  actionForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!activeAction || !activeAction.form || !conversationId || actionSubmitting) return;
    actionSubmitting = true;
    var values = {};
    Array.prototype.forEach.call(actionForm.elements, function (element) { if (element.name) values[element.name] = element.type === "checkbox" ? element.checked : element.value; });
    var consent = values.consent === true;
    delete values.consent;
    addMessage("Submitted your details.", true);
    try {
      var answer = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations/" + encodeURIComponent(conversationId) + "/actions/" + encodeURIComponent(activeAction.id) + "/submit", { method: "POST", body: JSON.stringify({ values: values, consent: consent }) });
      addMessage(answer.answer, false, answer.citations && answer.citations[0]);
      renderConversationStatus(answer.conversation && answer.conversation.status);
      if (answer.conversation && answer.conversation.status !== "AI_ACTIVE") startPolling();
      renderActionForm(answer.action);
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "Could not send your details.", false);
    } finally {
      actionSubmitting = false;
    }
  });
  lead.querySelector("button").addEventListener("click", async function () {
    var email = leadInput.value.trim();
    if (!email || !conversationId) return;
    if (config && config.agent && config.agent.requireLeadConsent && !leadConsent.checked) {
      addMessage("Please confirm that you agree to share your details.", false);
      return;
    }
    try {
      await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/leads", { method: "POST", body: JSON.stringify({ conversationId: conversationId, email: email, intent: lastQuestion, consent: true, consentAt: new Date().toISOString() }) });
      lead.classList.remove("open");
      addMessage("Thanks — the team can follow up with you.", false);
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "Could not send your details.", false);
    }
  });

  function recordAbandonment() {
    if (!conversationId) return;
    if (activeAction && activeAction.status === "completed") return;
    if (activeAction && activeAction.status === "active") {
      telemetry("FIELD_ABANDONED", { flowId: activeAction.id, fieldId: lastViewedField || undefined });
    }
    telemetry("CONVERSATION_ABANDONED", { flowId: activeAction ? activeAction.id : undefined });
  }
  window.addEventListener("pagehide", recordAbandonment);
  loadConfig().catch(function () { /* A manual open retries when the API is available. */ });
})();
