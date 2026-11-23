export interface PwaPushPayload {
  title?: string;
  body?: string;
  url?: string;
  conversationId?: string | null;
  notificationId?: string | null;
  type?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export function initializePwa(options: {
  onInstallAvailable?: (available: boolean) => void;
  onInstalled?: () => void;
  onPushMessage?: (payload: PwaPushPayload) => void;
} = {}): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    options.onInstallAvailable?.(true);
  };
  const handleInstalled = () => {
    deferredInstallPrompt = null;
    options.onInstallAvailable?.(false);
    options.onInstalled?.();
  };

  window.addEventListener("beforeinstallprompt", handleInstallPrompt);
  window.addEventListener("appinstalled", handleInstalled);

  if ("serviceWorker" in navigator) {
    registrationPromise = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
    navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
  }

  function handleServiceWorkerMessage(event: MessageEvent<PwaPushPayload & { type?: string }>) {
    if (event.data?.type === "frontdeskwise-push") options.onPushMessage?.(event.data);
  }

  return () => {
    window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    window.removeEventListener("appinstalled", handleInstalled);
    navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
  };
}

export async function installPwa(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome === "accepted";
}

export async function getPwaRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!registrationPromise) registrationPromise = navigator.serviceWorker.ready.catch(() => null);
  return registrationPromise;
}

export async function existingPushSubscription(): Promise<PushSubscription | null> {
  const registration = await getPwaRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
  const registration = await getPwaRegistration();
  if (!registration) throw new Error("Browser notifications are not available on this device.");
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Browser notifications were not allowed.");
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(publicKey),
  });
}

export async function unsubscribeFromPush(): Promise<PushSubscription | null> {
  const subscription = await existingPushSubscription();
  if (subscription) await subscription.unsubscribe();
  return subscription;
}

function decodeVapidKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}
