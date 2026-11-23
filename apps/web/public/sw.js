const CACHE_NAME = "frontdeskwise-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/site.webmanifest",
  "/frontdeskwise-logo-mark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/"));
    return;
  }

  event.respondWith(cacheAfterNetwork(event.request));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "" }; }
  const title = payload.title || "FrontDeskWise";
  const body = payload.body || "You have a new workspace update.";
  const url = safeUrl(payload.url || "/");
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: "/frontdeskwise-logo-mark.png",
      badge: "/frontdeskwise-logo-mark.png",
      tag: payload.notificationId || payload.conversationId || "frontdeskwise-update",
      renotify: true,
      data: { ...payload, url },
      actions: payload.conversationId ? [{ action: "open-inbox", title: "Open conversation" }] : [],
    });
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({ ...payload, type: "frontdeskwise-push", url }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data?.url || "/");
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => "focus" in client);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing && existing.url !== url) await existing.navigate(url);
      return;
    }
    await self.clients.openWindow(url);
  })());
});

function safeUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallback));
  }
}

async function cacheAfterNetwork(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return cache.match(request);
  }
}
