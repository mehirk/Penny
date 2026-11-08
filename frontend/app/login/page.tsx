"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, ScanFace, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/penny/app-shell";
import { Field } from "@/components/penny/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { biometryName, clearSignIn, FACE_ID_TRIES, faceIdDeclined, faceIdStatus, type FaceIdStatus, isCancelled, loadSignIn, saveSignIn, setAppSignedIn, setFaceIdDeclined } from "@/lib/face-id";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don’t match. Check them and try again.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/fetch|network/i.test(message)) return "Couldn’t reach the sign-in service. Check your connection and try again.";
  return message;
}

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // iPhone only: Face ID signs in with the sign-in saved in the Keychain, no password needed.
  const [faceId, setFaceId] = useState<FaceIdStatus | null>(null);
  // After a password sign-in, the offer to turn Face ID on (it needs the password to save it).
  const [offer, setOffer] = useState<{ email: string; password: string } | null>(null);
  const prompted = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Signed out: no app lock on top of this page (it asks for Face ID itself).
    setAppSignedIn(false);
    // Sent here by the app lock after Face ID failed twice: go straight to the password.
    const params = new URLSearchParams(window.location.search);
    const lockGaveUp = params.get("faceid") === "failed";
    // Sent here after Settings › Delete account.
    const deleted = params.get("deleted");
    void faceIdStatus().then((status) => {
      if (deleted === "all") setNotice("Your account and all its data were deleted.");
      if (deleted === "data") setNotice("All your data was deleted. Your email can still sign in, to a new, empty account.");
      setFaceId(status);
      if (lockGaveUp && status.saved) { setError(`${biometryName(status)} didn’t work. Sign in with your password.`); return; }
      // Opening the app with Face ID on goes straight to the Face ID prompt.
      if (configured && status.available && status.saved && !prompted.current) {
        prompted.current = true;
        void signInWithFaceId();
      }
    });
    // Runs once, on opening the sign-in page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Signs in with the email and password; returns an error message or null. */
  async function passwordSignIn(email: string, password: string): Promise<string | null> {
    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
      return authError ? authError.message : null;
    } catch (reason) {
      return reason instanceof Error ? reason.message : "Sign-in failed";
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const failed = await passwordSignIn(email, password);
    if (failed) { setError(friendlyAuthError(failed)); setBusy(false); return; }
    if (faceId?.available && !faceId.saved && !faceIdDeclined()) { setOffer({ email, password }); setBusy(false); return; }
    router.replace("/");
  }

  /**
   * Face ID, tried again once by itself if it fails or recognises no one within 5 seconds; after
   * the second failure Penny asks for the password, like the app lock.
   */
  async function signInWithFaceId() {
    setError("");
    setNotice("");
    setBusy(true);
    let saved: Awaited<ReturnType<typeof loadSignIn>> = "failed";
    for (let attempt = 1; attempt <= FACE_ID_TRIES; attempt += 1) {
      saved = await loadSignIn();
      if (saved !== "failed") break;
      if (attempt < FACE_ID_TRIES) {
        setNotice("Face ID didn’t recognise you. Trying again…");
        // Let the Face ID sheet close before asking again.
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
    }
    setNotice("");
    if (saved === "failed") {
      setError("Face ID didn’t work. Sign in with your password.");
      setBusy(false);
      window.setTimeout(() => passwordInput.current?.focus(), 0);
      return;
    }
    if (saved === "password") { setBusy(false); window.setTimeout(() => passwordInput.current?.focus(), 0); return; }
    if (typeof saved === "string") { setBusy(false); return; }
    const failed = await passwordSignIn(saved.email, saved.password);
    if (!failed) { router.replace("/"); return; }
    if (/invalid login credentials/i.test(failed)) {
      // The password changed since Face ID was turned on: forget it and ask for the new one.
      await clearSignIn();
      setFaceId((status) => (status ? { ...status, saved: false } : status));
      setError("Your password has changed. Sign in with it to turn Face ID back on.");
    } else {
      setError(friendlyAuthError(failed));
    }
    setBusy(false);
  }

  async function turnOnFaceId() {
    if (!offer) return;
    setError("");
    setBusy(true);
    try {
      await saveSignIn(offer.email, offer.password);
      setFaceIdDeclined(false);
      router.replace("/");
    } catch (reason) {
      if (!isCancelled(reason)) setError(`${faceId ? biometryName(faceId) : "Face ID"} couldn’t be turned on. You can try again from Settings.`);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-enter">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div><p className="text-lg font-semibold tracking-tight text-ink">Penny</p><p className="text-xs text-ink-subtle">Make money make sense</p></div>
        </div>
        <div className="mt-8 rounded-[1.5rem] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:p-7">
          {offer && faceId ? (
            <>
              <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-ink" aria-hidden="true"><ScanFace className="size-6" /></span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Use {biometryName(faceId)} next time?</h1>
              <p className="mt-1.5 text-sm text-ink-subtle">Sign in with a glance instead of your password. Your sign-in stays on this iPhone, locked by {biometryName(faceId)}. You can turn it off in Settings.</p>
              {error && <p role="alert" className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">{error}</p>}
              <div className="mt-6 space-y-2">
                <Button className="w-full" disabled={busy} onClick={() => void turnOnFaceId()}><ScanFace className="size-4" aria-hidden="true" />Turn on {biometryName(faceId)}</Button>
                <Button variant="ghost" className="w-full" disabled={busy} onClick={() => { setFaceIdDeclined(true); router.replace("/"); }}>Not now</Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
              <p className="mt-1.5 text-sm text-ink-subtle">Welcome back. Never use your bank’s password here.</p>
              {faceId?.available && faceId.saved && (
                <>
                  <Button variant="outline" className="mt-6 w-full" disabled={!configured || busy} onClick={() => void signInWithFaceId()}><ScanFace className="size-4" aria-hidden="true" />Sign in with {biometryName(faceId)}</Button>
                  <p className="mt-5 text-center text-xs text-ink-subtle">or use your password</p>
                </>
              )}
              <form onSubmit={signIn} className={faceId?.saved ? "mt-3 space-y-4" : "mt-6 space-y-4"}>
                <Field label="Email">{(props) => <Input {...props} name="email" type="email" autoComplete="email" required disabled={!configured || busy} />}</Field>
                {notice && <p role="status" className="rounded-xl bg-sage-soft px-3 py-2.5 text-sm text-ink-muted">{notice}</p>}
                <Field label="Password">{(props) => <Input {...props} ref={passwordInput} name="password" type="password" autoComplete="current-password" required disabled={!configured || busy} />}</Field>
                {error && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">{error}</p>}
                <Button type="submit" disabled={!configured || busy} className="w-full">
                  {busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Signing in…</> : "Sign in"}
                </Button>
              </form>
            </>
          )}
          {!configured && <p className="mt-4 rounded-xl bg-gold-soft p-3 text-sm text-gold-strong">Sign-in isn’t set up yet. Add the Supabase URL and publishable key to <code>frontend/.env.local</code>, then restart the dev server.</p>}
        </div>
        <p className="mt-5 flex items-start gap-2 text-xs text-ink-subtle"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />Penny uses only fictional accounts and amounts. No bank is ever connected.</p>
        <Link href="/" className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent-strong hover:underline"><ArrowLeft className="size-4" aria-hidden="true" />Back to Penny</Link>
      </div>
    </main>
  );
}
