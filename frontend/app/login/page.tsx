"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, ScanFace, ShieldCheck } from "lucide-react";
import { Mascot } from "@/components/penny/mascot";
import { Field } from "@/components/penny/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  biometryName,
  clearSignIn,
  FACE_ID_TRIES,
  faceIdDeclined,
  faceIdStatus,
  type FaceIdStatus,
  isCancelled,
  loadSignIn,
  saveSignIn,
  setAppSignedIn,
  setFaceIdDeclined,
} from "@/lib/face-id";
import { isNativeApp } from "@/lib/native";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message))
    return "That email and password don’t match. Check them and try again.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/fetch|network/i.test(message)) return "Couldn’t reach the sign-in service. Check your connection and try again.";
  if (/already registered|already exists/i.test(message))
    return "There’s already an account with that email. Sign in instead.";
  if (/signups? not allowed|signup is disabled/i.test(message))
    return "New accounts are paused right now. Try again soon.";
  if (/password should be|weak password/i.test(message))
    return `Pick a longer password: at least ${MIN_PASSWORD} characters.`;
  return message;
}

/** Shortest password the sign-up form accepts (Supabase's own minimum is lower). */
const MIN_PASSWORD = 8;

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
  // The website links back to the landing page; the iPhone app has no landing page.
  const [web, setWeb] = useState(false);
  // "signup" shows the create-an-account form (also opened by /login?new=1).
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    // Signed out: no app lock on top of this page (it asks for Face ID itself).
    setAppSignedIn(false);
    // Sent here by the app lock after Face ID failed twice: go straight to the password.
    const params = new URLSearchParams(window.location.search);
    const lockGaveUp = params.get("faceid") === "failed";
    // Sent here after Settings › Delete account.
    const deleted = params.get("deleted");
    // Sent here to make an account (the website's "Create your account").
    const signingUp = params.get("new") === "1";
    void faceIdStatus().then((status) => {
      setWeb(!isNativeApp());
      if (signingUp) {
        setMode("signup");
        return;
      }
      if (deleted === "all") setNotice("Your account and all its data were deleted.");
      if (deleted === "data")
        setNotice("All your data was deleted. Your email can still sign in, to a new, empty account.");
      setFaceId(status);
      if (lockGaveUp && status.saved) {
        setError(`${biometryName(status)} didn’t work. Sign in with your password.`);
        return;
      }
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
    if (failed) {
      setError(friendlyAuthError(failed));
      setBusy(false);
      return;
    }
    if (faceId?.available && !faceId.saved && !faceIdDeclined()) {
      setOffer({ email, password });
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  /** Creates an account. Signs straight in when the project needs no email confirmation. */
  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    if (password.length < MIN_PASSWORD) {
      setError(`Pick a longer password: at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      const { data, error: authError } = await createSupabaseBrowserClient().auth.signUp({
        email,
        password,
        // The confirmation link opens the website's sign-in page (the iPhone app has no web address).
        options: isNativeApp() ? undefined : { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (authError) {
        setError(friendlyAuthError(authError.message));
        setBusy(false);
        return;
      }
      if (data.session) {
        router.replace("/");
        return;
      }
      // Email confirmation is on: Supabase sent a link. (An email already in use also lands here,
      // with no identities, so nobody can find out which emails have accounts.)
      setMode("signin");
      setNotice(`Check ${email} for a link to confirm your account, then sign in here.`);
    } catch (reason) {
      setError(friendlyAuthError(reason instanceof Error ? reason.message : "Couldn’t create the account"));
    }
    setBusy(false);
  }

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
    setNotice("");
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
    if (saved === "password") {
      setBusy(false);
      window.setTimeout(() => passwordInput.current?.focus(), 0);
      return;
    }
    if (typeof saved === "string") {
      setBusy(false);
      return;
    }
    const failed = await passwordSignIn(saved.email, saved.password);
    if (!failed) {
      router.replace("/");
      return;
    }
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
      if (!isCancelled(reason))
        setError(
          `${faceId ? biometryName(faceId) : "Face ID"} couldn’t be turned on. You can try again from Settings.`,
        );
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-x-clip px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_24rem_at_15%_0%,rgb(25_179_148/0.16),transparent),radial-gradient(36rem_24rem_at_95%_10%,rgb(182_125_242/0.16),transparent)]"
      />
      <div className="relative w-full max-w-sm animate-enter">
        <div className="flex items-center gap-3">
          <Mascot className="size-16 shrink-0 animate-bob" />
          <div>
            <p className="text-lg font-semibold tracking-tight text-ink">Penny</p>
            <p className="text-xs text-ink-subtle">Your wallet. Your coach.</p>
          </div>
        </div>
        <div className="mt-8 rounded-[1.5rem] border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:p-7">
          {offer && faceId ? (
            <>
              <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-ink" aria-hidden="true">
                <ScanFace className="size-6" />
              </span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
                Use {biometryName(faceId)} next time?
              </h1>
              <p className="mt-1.5 text-sm text-ink-subtle">
                Sign in with a glance instead of your password. Your sign-in stays on this iPhone, locked by{" "}
                {biometryName(faceId)}. You can turn it off in Settings.
              </p>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
                >
                  {error}
                </p>
              )}
              <div className="mt-6 space-y-2">
                <Button className="w-full" disabled={busy} onClick={() => void turnOnFaceId()}>
                  <ScanFace className="size-4" aria-hidden="true" />
                  Turn on {biometryName(faceId)}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() => {
                    setFaceIdDeclined(true);
                    router.replace("/");
                  }}
                >
                  Not now
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {mode === "signup" ? "Create your account" : "Sign in"}
              </h1>
              <p className="mt-1.5 text-sm text-ink-subtle">
                {mode === "signup"
                  ? "Free for students. Pick a new password, never your bank’s."
                  : "Welcome back. Never use your bank’s password here."}
              </p>
              {mode === "signin" && faceId?.available && faceId.saved && (
                <>
                  <Button
                    variant="outline"
                    className="mt-6 w-full"
                    disabled={!configured || busy}
                    onClick={() => void signInWithFaceId()}
                  >
                    <ScanFace className="size-4" aria-hidden="true" />
                    Sign in with {biometryName(faceId)}
                  </Button>
                  <p className="mt-5 text-center text-xs text-ink-subtle">or use your password</p>
                </>
              )}
              <form
                onSubmit={mode === "signup" ? signUp : signIn}
                className={mode === "signin" && faceId?.saved ? "mt-3 space-y-4" : "mt-6 space-y-4"}
              >
                <Field label="Email">
                  {(props) => (
                    <Input
                      {...props}
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={!configured || busy}
                    />
                  )}
                </Field>
                {notice && (
                  <p role="status" className="rounded-xl bg-sage-soft px-3 py-2.5 text-sm text-ink-muted">
                    {notice}
                  </p>
                )}
                <Field label="Password" hint={mode === "signup" ? `At least ${MIN_PASSWORD} characters.` : undefined}>
                  {(props) => (
                    <Input
                      {...props}
                      ref={passwordInput}
                      name="password"
                      type="password"
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      minLength={mode === "signup" ? MIN_PASSWORD : undefined}
                      required
                      disabled={!configured || busy}
                    />
                  )}
                </Field>
                {error && (
                  <p
                    role="alert"
                    className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
                  >
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={!configured || busy} className="w-full">
                  {busy ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      {mode === "signup" ? "Creating your account…" : "Signing in…"}
                    </>
                  ) : mode === "signup" ? (
                    "Create account"
                  ) : (
                    "Sign in"
                  )}
                </Button>
              </form>
              <p className="mt-4 text-center text-sm text-ink-subtle">
                {mode === "signup" ? "Already have an account?" : "New to Penny?"}{" "}
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center font-semibold text-accent-strong hover:underline"
                  disabled={busy}
                  onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
            </>
          )}
          {!configured && (
            <p className="mt-4 rounded-xl bg-gold-soft p-3 text-sm text-gold-strong">
              Sign-in isn’t set up yet. Add the Supabase URL and publishable key to <code>frontend/.env.local</code>,
              then restart the dev server.
            </p>
          )}
        </div>
        <p className="mt-5 flex items-start gap-2 text-xs text-ink-subtle">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          No bank is ever connected. You type in what you want Penny to know, and you can delete it any time.
        </p>
        {web && (
          <Link
            href="/welcome"
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent-strong hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to home
          </Link>
        )}
      </div>
    </main>
  );
}
