import { getApp, getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, confirmPasswordReset, onIdTokenChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithPopup, setPersistence, signInWithEmailAndPassword, signOut, verifyPasswordResetCode, } from "firebase/auth";
export class AuthSessionExpiredError extends Error {
    constructor() {
        super("Your FrontDeskWise session is no longer valid.");
        this.name = "AuthSessionExpiredError";
    }
}
function readConfig() {
    const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY ?? "").trim();
    const authDomain = String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim();
    const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim();
    const appId = String(import.meta.env.VITE_FIREBASE_APP_ID ?? "").trim();
    if (!apiKey || !authDomain || !projectId || !appId)
        return null;
    return { apiKey, authDomain, projectId, appId };
}
export function firebaseAuthConfigured() {
    return Boolean(readConfig());
}
function firebaseApp() {
    const config = readConfig();
    if (!config)
        throw new Error("Firebase sign-in is not configured yet.");
    return getApps().length ? getApp() : initializeApp(config);
}
let persistencePromise = null;
async function firebaseAuth() {
    const auth = getAuth(firebaseApp());
    persistencePromise ??= setPersistence(auth, browserLocalPersistence);
    await persistencePromise;
    return auth;
}
function apiOrigin() {
    return String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
}
function passwordResetActionSettings() {
    const configuredOrigin = String(import.meta.env.VITE_SITE_ORIGIN ?? "").trim().replace(/\/$/, "");
    const origin = configuredOrigin || (typeof window !== "undefined" ? window.location.origin : "");
    if (!origin)
        throw new Error("Password recovery is temporarily unavailable.");
    return { url: `${origin}/auth/reset-password`, handleCodeInApp: false };
}
async function bootstrap(user, demoToken, organizationName) {
    let token = await user.getIdToken();
    let response = await fetch(`${apiOrigin()}/api/v1/auth/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ demoToken: demoToken || undefined, organizationName: organizationName || undefined }),
    });
    if (response.status === 401) {
        try {
            token = await user.getIdToken(true);
        }
        catch {
            throw new AuthSessionExpiredError();
        }
        response = await fetch(`${apiOrigin()}/api/v1/auth/bootstrap`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ demoToken: demoToken || undefined, organizationName: organizationName || undefined }),
        });
    }
    const payload = await response.json();
    if (response.status === 401)
        throw new AuthSessionExpiredError();
    if (!response.ok)
        throw new Error(payload.error ?? "Could not finish account setup.");
    return payload;
}
export async function signInAndBootstrap(email, password, demoToken, organizationName) {
    const auth = await firebaseAuth();
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    return bootstrap(credential.user, demoToken, organizationName);
}
export async function signUpAndBootstrap(email, password, demoToken, organizationName) {
    const auth = await firebaseAuth();
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await sendEmailVerification(credential.user);
    return bootstrap(credential.user, demoToken, organizationName);
}
export async function resendFrontDeskWiseVerificationEmail() {
    const auth = await firebaseAuth();
    const user = auth.currentUser;
    if (!user)
        throw new Error("Sign in again before requesting a verification email.");
    await reload(user);
    if (user.emailVerified)
        return;
    await sendEmailVerification(user);
}
export async function signInWithGoogleAndBootstrap(demoToken, organizationName) {
    const auth = await firebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(auth, provider);
    return bootstrap(credential.user, demoToken, organizationName);
}
export async function signOutFrontDeskWise() {
    if (!firebaseAuthConfigured())
        return;
    await signOut(await firebaseAuth());
}
export async function sendFrontDeskWisePasswordReset(email) {
    if (!email.trim())
        throw new Error("Enter your email first.");
    await sendPasswordResetEmail(await firebaseAuth(), email.trim(), passwordResetActionSettings());
}
export async function verifyFrontDeskWisePasswordResetCode(actionCode) {
    if (!actionCode.trim())
        throw new Error("This reset link is invalid or has expired.");
    return verifyPasswordResetCode(await firebaseAuth(), actionCode.trim());
}
export async function confirmFrontDeskWisePasswordReset(actionCode, newPassword) {
    if (!actionCode.trim())
        throw new Error("This reset link is invalid or has expired.");
    if (newPassword.length < 6)
        throw new Error("Use at least 6 characters for your new password.");
    await confirmPasswordReset(await firebaseAuth(), actionCode.trim(), newPassword);
}
export function observeFirebaseUser(callback) {
    if (!firebaseAuthConfigured())
        return () => undefined;
    let active = true;
    let unsubscribe = null;
    // Wait for Firebase's browser-local persistence to finish restoring the
    // previous session before subscribing. Without this, the app can render the
    // signed-out landing state during a hard refresh even though Firebase is
    // about to restore a valid user.
    void firebaseAuth()
        .then((auth) => {
        if (!active)
            return;
        unsubscribe = onIdTokenChanged(auth, callback);
    })
        .catch(() => {
        // If browser storage is unavailable, still observe Firebase's in-memory
        // session so sign-in continues to work for the current tab.
        if (!active)
            return;
        try {
            unsubscribe = onIdTokenChanged(getAuth(firebaseApp()), callback);
        }
        catch {
            callback(null);
        }
    });
    return () => {
        active = false;
        unsubscribe?.();
    };
}
export async function currentAuthSnapshot(organizationName) {
    if (!firebaseAuthConfigured())
        return null;
    const auth = await firebaseAuth();
    const user = auth.currentUser;
    if (!user)
        return null;
    // Firebase can keep the cached User object (and its ID token) marked as
    // unverified after the user confirms the link in another tab. Refresh the
    // profile before asking the API for the workspace snapshot so a normal page
    // reload can observe the new emailVerified state without signing out.
    if (!user.emailVerified)
        await reload(user);
    let token = await user.getIdToken(user.emailVerified);
    let response = await fetch(`${apiOrigin()}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 401) {
        try {
            token = await user.getIdToken(true);
        }
        catch {
            throw new AuthSessionExpiredError();
        }
        response = await fetch(`${apiOrigin()}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) {
        // A Firebase user can outlive an interrupted first bootstrap. Repair that
        // state on the next refresh instead of treating the persisted session as
        // signed out.
        return bootstrap(user, undefined, organizationName);
    }
    if (response.status === 401)
        throw new AuthSessionExpiredError();
    if (!response.ok)
        throw new Error(payload.error ?? "Could not restore the FrontDeskWise session.");
    return payload;
}
export async function currentFirebaseToken(forceRefresh = false) {
    if (!firebaseAuthConfigured())
        return "";
    const user = (await firebaseAuth()).currentUser;
    return user ? user.getIdToken(forceRefresh) : "";
}
