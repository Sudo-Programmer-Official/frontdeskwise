import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  confirmPasswordReset,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithPopup,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  verifyPasswordResetCode,
  type User,
} from "firebase/auth";

export type AuthBusiness = {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  isDemo: boolean;
  billingStatus: string;
  planKey: string;
  role: string;
};

export type AuthOrganizationBilling = {
  mode: "sandbox" | "live";
  status: string;
  planKey: string;
  interval: "month" | "year" | null;
  trialStartAt: string | null;
  trialEndAt: string | null;
  currentPeriodEndAt: string | null;
  graceEndAt: string | null;
  amountCents: number | null;
  currency: string;
  access: { allowed: boolean; reason: string };
  plan: { key: string; displayName: string; description: string; amountCents: number | null; currency: string; maxBusinesses: number };
  override: { reason: string } | null;
};

export type AuthOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  billing: AuthOrganizationBilling;
  businesses: AuthBusiness[];
  metrics: { conversations: number; leads: number; bookings: number };
};

export type AuthSnapshot = {
  user: { id: string; email: string; name: string; isSuperAdmin: boolean };
  organizations: AuthOrganization[];
  activeOrganizationId: string | null;
};

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

export class AuthSessionExpiredError extends Error {
  constructor() {
    super("Your FrontDeskWise session is no longer valid.");
    this.name = "AuthSessionExpiredError";
  }
}

function readConfig(): FirebaseConfig | null {
  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY ?? "").trim();
  const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim();
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
  const appId = String(import.meta.env.VITE_FIREBASE_APP_ID ?? "").trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

export function firebaseAuthConfigured(): boolean {
  return Boolean(readConfig());
}

function firebaseApp(): FirebaseApp {
  const config = readConfig();
  if (!config) throw new Error("Firebase sign-in is not configured yet.");
  return getApps().length ? getApp() : initializeApp(config);
}

let persistencePromise: Promise<void> | null = null;

async function firebaseAuth() {
  const auth = getAuth(firebaseApp());
  persistencePromise ??= setPersistence(auth, browserLocalPersistence);
  await persistencePromise;
  return auth;
}

function apiOrigin(): string {
  return String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
}

function passwordResetActionSettings() {
  const configuredOrigin = String(import.meta.env.VITE_SITE_ORIGIN ?? "").trim().replace(/\/$/, "");
  const origin = configuredOrigin || (typeof window !== "undefined" ? window.location.origin : "");
  if (!origin) throw new Error("Password recovery is temporarily unavailable.");
  return { url: `${origin}/auth/reset-password`, handleCodeInApp: false } as const;
}

async function bootstrap(user: User, demoToken?: string, organizationName?: string): Promise<AuthSnapshot> {
  let token = await user.getIdToken();
  let response = await fetch(`${apiOrigin()}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ demoToken: demoToken || undefined, organizationName: organizationName || undefined }),
  });
  if (response.status === 401) {
    try {
      token = await user.getIdToken(true);
    } catch {
      throw new AuthSessionExpiredError();
    }
    response = await fetch(`${apiOrigin()}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ demoToken: demoToken || undefined, organizationName: organizationName || undefined }),
    });
  }
  const payload = await response.json() as AuthSnapshot & { error?: string };
  if (response.status === 401) throw new AuthSessionExpiredError();
  if (!response.ok) throw new Error(payload.error ?? "Could not finish account setup.");
  return payload;
}

export async function signInAndBootstrap(email: string, password: string, demoToken?: string, organizationName?: string): Promise<AuthSnapshot> {
  const auth = await firebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return bootstrap(credential.user, demoToken, organizationName);
}

export async function signUpAndBootstrap(email: string, password: string, demoToken?: string, organizationName?: string): Promise<AuthSnapshot> {
  const auth = await firebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  return bootstrap(credential.user, demoToken, organizationName);
}

export async function signInWithGoogleAndBootstrap(demoToken?: string, organizationName?: string): Promise<AuthSnapshot> {
  const auth = await firebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  return bootstrap(credential.user, demoToken, organizationName);
}

export async function signOutFrontDeskWise(): Promise<void> {
  if (!firebaseAuthConfigured()) return;
  await signOut(await firebaseAuth());
}

export async function sendFrontDeskWisePasswordReset(email: string): Promise<void> {
  if (!email.trim()) throw new Error("Enter your email first.");
  await sendPasswordResetEmail(await firebaseAuth(), email.trim(), passwordResetActionSettings());
}

export async function verifyFrontDeskWisePasswordResetCode(actionCode: string): Promise<string> {
  if (!actionCode.trim()) throw new Error("This reset link is invalid or has expired.");
  return verifyPasswordResetCode(await firebaseAuth(), actionCode.trim());
}

export async function confirmFrontDeskWisePasswordReset(actionCode: string, newPassword: string): Promise<void> {
  if (!actionCode.trim()) throw new Error("This reset link is invalid or has expired.");
  if (newPassword.length < 6) throw new Error("Use at least 6 characters for your new password.");
  await confirmPasswordReset(await firebaseAuth(), actionCode.trim(), newPassword);
}

export function observeFirebaseUser(callback: (user: User | null) => void): () => void {
  if (!firebaseAuthConfigured()) return () => undefined;
  let active = true;
  let unsubscribe: (() => void) | null = null;

  // Wait for Firebase's browser-local persistence to finish restoring the
  // previous session before subscribing. Without this, the app can render the
  // signed-out landing state during a hard refresh even though Firebase is
  // about to restore a valid user.
  void firebaseAuth()
    .then((auth) => {
      if (!active) return;
      unsubscribe = onIdTokenChanged(auth, callback);
    })
    .catch(() => {
      // If browser storage is unavailable, still observe Firebase's in-memory
      // session so sign-in continues to work for the current tab.
      if (!active) return;
      try {
        unsubscribe = onIdTokenChanged(getAuth(firebaseApp()), callback);
      } catch {
        callback(null);
      }
    });

  return () => {
    active = false;
    unsubscribe?.();
  };
}

export async function currentAuthSnapshot(organizationName?: string): Promise<AuthSnapshot | null> {
  if (!firebaseAuthConfigured()) return null;
  const auth = await firebaseAuth();
  const user = auth.currentUser;
  if (!user) return null;
  let token = await user.getIdToken();
  let response = await fetch(`${apiOrigin()}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    try {
      token = await user.getIdToken(true);
    } catch {
      throw new AuthSessionExpiredError();
    }
    response = await fetch(`${apiOrigin()}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  }
  const payload = await response.json().catch(() => ({})) as AuthSnapshot & { error?: string };
  if (response.status === 404) {
    // A Firebase user can outlive an interrupted first bootstrap. Repair that
    // state on the next refresh instead of treating the persisted session as
    // signed out.
    return bootstrap(user, undefined, organizationName);
  }
  if (response.status === 401) throw new AuthSessionExpiredError();
  if (!response.ok) throw new Error(payload.error ?? "Could not restore the FrontDeskWise session.");
  return payload;
}

export async function currentFirebaseToken(forceRefresh = false): Promise<string> {
  if (!firebaseAuthConfigured()) return "";
  const user = (await firebaseAuth()).currentUser;
  return user ? user.getIdToken(forceRefresh) : "";
}
