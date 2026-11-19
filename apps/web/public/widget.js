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
      .launcher { position: fixed; right: 22px; bottom: 22px; z-index: 2147483000; width: 58px; height: 58px; border: 0; border-radius: 18px; color: #fff; background: #0d6efd; box-shadow: 0 14px 30px rgba(13, 75, 160, .28); cursor: pointer; font-size: 24px; }
      .panel { position: fixed; right: 22px; bottom: 92px; z-index: 2147483000; display: none; width: min(360px, calc(100vw - 32px)); overflow: hidden; border: 1px solid #dfe7f2; border-radius: 18px; color: #1c2d49; background: #fff; box-shadow: 0 24px 70px rgba(13, 44, 91, .24); }
      .panel.open { display: block; }
      .header { display: flex; align-items: center; gap: 10px; padding: 17px; color: #fff; background: var(--accent, #0d6efd); }
      .orb { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: rgba(255,255,255,.22); font-weight: 900; }
      .header strong { flex: 1; font-size: 13px; }.close { border: 0; color: #fff; background: transparent; cursor: pointer; font-size: 20px; }
      .messages { display: grid; gap: 9px; max-height: 300px; overflow: auto; padding: 15px; background: #fbfcfe; }
      .message { max-width: 88%; padding: 10px 11px; border-radius: 5px 13px 13px 13px; color: #4c5e78; background: #eef4fb; font-size: 12px; line-height: 1.45; }.message.user { justify-self: end; border-radius: 13px 5px 13px 13px; color: #fff; background: var(--accent, #0d6efd); }.message a { display: block; margin-top: 7px; color: #1c6bd4; font-size: 10px; font-weight: 800; }
      .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #edf1f6; }.composer input { min-width: 0; flex: 1; padding: 10px; border: 1px solid #dbe4ef; border-radius: 9px; outline: none; color: #243957; font-size: 12px; }.composer button, .lead button { border: 0; border-radius: 9px; color: #fff; background: var(--accent, #0d6efd); cursor: pointer; font-weight: 800; }.composer button { width: 38px; }.lead { display: none; gap: 7px; padding: 0 15px 13px; }.lead.open { display: grid; }.lead small { color: #7b8aa0; font-size: 10px; }.lead input { padding: 9px; border: 1px solid #dbe4ef; border-radius: 8px; outline: none; font-size: 11px; }.lead button { padding: 9px; font-size: 11px; }
      .status { padding: 12px 15px; color: #8a98aa; font-size: 11px; }
      @media (max-width: 520px) { .launcher { right: 16px; bottom: 16px; }.panel { right: 16px; bottom: 86px; } }
    </style>
    <button class="launcher" aria-label="Open AI front desk">✦</button>
    <section class="panel" aria-label="AI front desk">
      <header class="header"><span class="orb">✦</span><strong class="title">AI front desk</strong><button class="close" aria-label="Close">×</button></header>
      <div class="messages"></div>
      <div class="lead"><small>Want a team member to follow up?</small><input type="email" placeholder="Your email" aria-label="Your email"/><button>Send details</button></div>
      <form class="composer"><input placeholder="Ask a question…" aria-label="Ask a question"/><button aria-label="Send">➤</button></form>
    </section>`;

  var launcher = shadow.querySelector(".launcher");
  var panel = shadow.querySelector(".panel");
  var close = shadow.querySelector(".close");
  var title = shadow.querySelector(".title");
  var messages = shadow.querySelector(".messages");
  var composer = shadow.querySelector(".composer");
  var input = composer.querySelector("input");
  var lead = shadow.querySelector(".lead");
  var leadInput = lead.querySelector("input");
  var conversationId = null;
  var lastQuestion = "";
  var config = null;

  function addMessage(text, user, citation) {
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

  async function api(path, options) {
    var response = await fetch(apiBase + path, Object.assign({ headers: { "content-type": "application/json" } }, options || {}));
    var payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The front desk is unavailable.");
    return payload;
  }

  async function loadConfig() {
    var payload = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/config");
    config = payload;
    panel.style.setProperty("--accent", payload.agent.widgetColor || "#0d6efd");
    title.textContent = payload.agent.assistantName || "AI front desk";
    addMessage(payload.agent.welcomeMessage || "Hi! How can I help?", false);
  }

  async function ask(question) {
    addMessage(question, true);
    lastQuestion = question;
    input.value = "";
    try {
      if (!conversationId) {
        var started = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations", { method: "POST", body: JSON.stringify({ sessionId: "widget-" + Date.now() }) });
        conversationId = started.conversationId;
      }
      var answer = await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/conversations/" + encodeURIComponent(conversationId) + "/messages", { method: "POST", body: JSON.stringify({ question: question }) });
      addMessage(answer.answer, false, answer.citations && answer.citations[0]);
      if (!answer.grounded) lead.classList.add("open");
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "The front desk is unavailable.", false);
    }
  }

  launcher.addEventListener("click", function () { panel.classList.toggle("open"); if (panel.classList.contains("open") && !config) loadConfig().catch(function (error) { addMessage(error.message, false); }); });
  close.addEventListener("click", function () { panel.classList.remove("open"); });
  composer.addEventListener("submit", function (event) { event.preventDefault(); var question = input.value.trim(); if (question) ask(question); });
  lead.querySelector("button").addEventListener("click", async function () {
    var email = leadInput.value.trim();
    if (!email || !conversationId) return;
    try { await api("/api/v1/widget/" + encodeURIComponent(siteKey) + "/leads", { method: "POST", body: JSON.stringify({ conversationId: conversationId, email: email, intent: lastQuestion }) }); lead.classList.remove("open"); addMessage("Thanks — the team can follow up with you.", false); } catch (error) { addMessage(error instanceof Error ? error.message : "Could not send your details.", false); }
  });
})();
