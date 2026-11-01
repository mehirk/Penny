import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Sign in with Face ID, in the iOS app only. The native side (ios/App/App/FaceIDPlugin.swift)
 * keeps the email and password in the iPhone's Keychain, readable only after Face ID; nothing is
 * sent anywhere else. In a browser every call reports Face ID as unavailable.
 */
type Biometry = "faceID" | "touchID" | "none";
export type FaceIdStatus = { available: boolean; biometry: Biometry; saved: boolean };
type SavedSignIn = { email: string; password: string };

type FaceIdPlugin = {
  status(): Promise<FaceIdStatus>;
  save(options: SavedSignIn): Promise<void>;
  load(options: { reason: string }): Promise<SavedSignIn>;
  clear(): Promise<void>;
  setSignedIn(options: { signedIn: boolean }): Promise<void>;
};

const plugin = registerPlugin<FaceIdPlugin>("PennyFaceID");
const OFF: FaceIdStatus = { available: false, biometry: "none", saved: false };

/** Asked once after a password sign-in; "Not now" is remembered on this device. */
const DECLINED_KEY = "penny-face-id-declined";

export async function faceIdStatus(): Promise<FaceIdStatus> {
  if (!Capacitor.isNativePlatform()) return OFF;
  try { return await plugin.status(); } catch { return OFF; }
}

/** "Face ID" or "Touch ID", for labels. */
export const biometryName = (status: FaceIdStatus) => (status.biometry === "touchID" ? "Touch ID" : "Face ID");

/** Shows Face ID once to confirm, then saves the sign-in behind it. */
export const saveSignIn = (email: string, password: string) => plugin.save({ email, password });

/** Shows Face ID and returns the saved sign-in, or null if cancelled or none is saved. */
export async function loadSignIn(): Promise<SavedSignIn | null> {
  try { return await plugin.load({ reason: "Sign in to Penny" }); } catch { return null; }
}

export async function clearSignIn(): Promise<void> {
  if (Capacitor.isNativePlatform()) await plugin.clear().catch(() => undefined);
}

/**
 * Tells the iPhone app whether someone is signed in. With Face ID on, the app then locks itself
 * whenever it leaves the screen and asks for Face ID on return (AppLock in FaceIDPlugin.swift).
 */
export function setAppSignedIn(signedIn: boolean): void {
  if (Capacitor.isNativePlatform()) plugin.setSignedIn({ signedIn }).catch(() => undefined);
}

/** True when the user error came from cancelling the Face ID prompt (no message needed). */
export const isCancelled = (reason: unknown) => typeof reason === "object" && reason !== null && "code" in reason && (reason as { code?: string }).code === "cancelled";

export function faceIdDeclined(): boolean {
  try { return window.localStorage.getItem(DECLINED_KEY) === "1"; } catch { return false; }
}
export function setFaceIdDeclined(declined: boolean): void {
  try { if (declined) window.localStorage.setItem(DECLINED_KEY, "1"); else window.localStorage.removeItem(DECLINED_KEY); } catch { /* storage blocked: ask again next time */ }
}
