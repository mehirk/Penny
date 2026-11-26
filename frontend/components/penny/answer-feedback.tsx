"use client";

import { useState } from "react";
import { Check, LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import type { AnswerFeedback, FeedbackReason } from "@/lib/api";
import { haptic } from "@/lib/native";
import { cn } from "@/lib/utils";

const REASONS: { id: FeedbackReason; label: string }[] = [
  { id: "wrong_numbers", label: "Numbers look wrong" },
  { id: "unclear", label: "Hard to follow" },
  { id: "not_what_i_asked", label: "Not what I asked" },
  { id: "other", label: "Something else" },
];

/**
 * "Was this helpful?" under a Penny AI answer: one tap, and a one-tap reason when it wasn't.
 * No free text, so nothing personal is stored. Ratings measure Penny and flag answers to check.
 */
export function AnswerFeedbackRow({
  value,
  onRate,
}: {
  value: AnswerFeedback | null | undefined;
  /** Saves the rating; rejects when it couldn't be saved. */
  onRate: (feedback: AnswerFeedback) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function rate(feedback: AnswerFeedback) {
    setSaving(true);
    setError("");
    try {
      await onRate(feedback);
      haptic("selection");
    } catch {
      setError("That didn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const thumb = (helpful: boolean) => {
    const Icon = helpful ? ThumbsUp : ThumbsDown;
    const on = value?.helpful === helpful;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={helpful ? "Helpful" : "Not helpful"}
        disabled={saving}
        onClick={() => void rate({ helpful, reason: null })}
        className={cn(
          "grid size-11 place-items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60",
          on
            ? helpful
              ? "border-[#0f8a72] bg-[#0f8a72] text-white"
              : "border-ink bg-ink text-surface"
            : "border-line text-ink-subtle hover:border-accent hover:text-ink",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 text-sm text-ink-muted">
          {value ? (value.helpful ? "Thanks! Glad it helped." : "Thanks. What was off?") : "Was this helpful?"}
        </p>
        <div role="group" aria-label="Was this helpful?" className="flex gap-2">
          {thumb(true)}
          {thumb(false)}
        </div>
        {saving && <LoaderCircle className="size-4 animate-spin text-ink-subtle" aria-hidden="true" />}
      </div>
      {value && !value.helpful && (
        <div role="group" aria-label="What was off?" className="flex flex-wrap gap-2">
          {REASONS.map((reason) => {
            const on = value.reason === reason.id;
            return (
              <button
                key={reason.id}
                type="button"
                aria-pressed={on}
                disabled={saving}
                onClick={() => void rate({ helpful: false, reason: reason.id })}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  on
                    ? "border-ink bg-ink text-surface"
                    : "border-line text-ink-muted hover:border-accent hover:text-ink",
                )}
              >
                {on && <Check className="size-3.5" aria-hidden="true" />}
                {reason.label}
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
