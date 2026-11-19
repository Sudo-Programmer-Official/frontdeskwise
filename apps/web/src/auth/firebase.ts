import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithPopup,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
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
  user: { id: string; email: string; name: string };
  organizations: AuthOrganization[];
  activeOrganizationId: string | null;
};

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

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

async function bootstrap(user: User, demoToken?: string, organizationName?: string): Promise<AuthSnapshot> {
  const token = await user.getIdToken();
  const response = await fetch(`${apiOrigin()}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ demoToken: demoToken || undefined, organizationName: organizationName || undefined }),
  });
  const payload = await response.json() as AuthSnapshot & { error?: string };
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
  await sendPasswordResetEmail(await firebaseAuth(), email.trim());
}

export function observeFirebaseUser(callback: (user: User | null) => void): () => void {
  if (!firebaseAuthConfigured()) return () => undefined;
  const auth = getAuth(firebaseApp());
  return onIdTokenChanged(auth, callback);
}

export async function currentAuthSnapshot(): Promise<AuthSnapshot | null> {
  if (!firebaseAuthConfigured()) return null;
  const auth = await firebaseAuth();
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const response = await fetch(`${apiOrigin()}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return await response.json() as AuthSnapshot;
}
