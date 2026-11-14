"use client";

import Link from "next/link";
import { CloudOff, LogIn, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Mascot } from "./mascot";
import type { describeError } from "./shared";

/** The standard loading state inside a page: shapes where the numbers and cards will be. */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-2xl animate-pulse space-y-4" aria-busy="true">
      <div className="mx-auto h-14 w-56 rounded-2xl bg-sage" />
      <div className="mx-auto h-4 w-40 rounded-full bg-sage" />
      {["a", "b", "c", "d"].map((key) => (
        <div key={key} className="h-[4.5rem] rounded-[var(--radius-card)] border border-line bg-surface" />
      ))}
      <output className="sr-only">Loading</output>
    </div>
  );
}

/** First load: the shape of Home (headline, then cards in one column, or two on wide screens). */
export function DashboardSkeleton() {
  const card = "h-[4.5rem] rounded-[var(--radius-card)] border border-line bg-surface";
  return (
    <div className="relative min-h-dvh lg:pl-64" aria-busy="true">
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r border-line lg:block" />
      {/* Penny waits with you (outside the pulsing shapes, so she stays solid). */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] flex flex-col items-center gap-2 lg:left-64 lg:top-20">
        <Mascot className="size-20 animate-bob" />
        <p className="text-sm font-medium text-ink-subtle">Counting your coins…</p>
      </div>
      <div className="mx-auto max-w-6xl animate-pulse px-4 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 lg:px-10 lg:pt-8">
        <div className="h-5 w-32 rounded-full bg-sage" />
        <div className="mx-auto mt-40 h-16 w-60 rounded-2xl bg-sage" />
        <div className="mx-auto mt-4 h-4 w-44 rounded-full bg-sage" />
        <div className="mx-auto mt-6 h-1.5 w-60 rounded-full bg-sage" />
        <div className="mt-12 grid gap-6 lg:grid-cols-2 lg:gap-8">
          {["left", "right"].map((column) => (
            <div key={column} className="space-y-2.5">
              <div className="mb-3 h-4 w-24 rounded-full bg-sage" />
              {[1, 2, 3].map((row) => (
                <div key={row} className={card} />
              ))}
            </div>
          ))}
        </div>
        <output className="sr-only">Loading your Penny dashboard</output>
      </div>
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: ReturnType<typeof describeError>; onRetry: () => void }) {
  const Icon = error.needsSignIn ? LogIn : CloudOff;
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md animate-enter rounded-[1.5rem] border border-line bg-surface p-6 text-center shadow-[var(--shadow-raised)] sm:p-8">
        <div className="relative mx-auto w-fit">
          <Mascot className="size-24 animate-shake" mood={error.needsSignIn ? "wow" : "sad"} />
          <span
            className={
              error.needsSignIn
                ? "absolute -bottom-1 -right-2 grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-strong"
                : "absolute -bottom-1 -right-2 grid size-9 place-items-center rounded-xl bg-danger-soft text-danger"
            }
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">{error.title}</h1>
        <p className="mt-2 text-sm text-ink-muted" role="alert">
          {error.detail}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {error.needsSignIn ? (
            <Link href="/login" className={buttonVariants()}>
              <LogIn className="size-4" aria-hidden="true" />
              Sign in
            </Link>
          ) : null}
          <Button variant={error.needsSignIn ? "outline" : "default"} onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
