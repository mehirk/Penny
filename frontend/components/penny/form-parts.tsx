import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseCadToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Resolves to an error message to show in the dialog, or null on success. */
export type Submit<T> = (body: T) => Promise<string | null>;

/** A positive CAD amount typed into a form, as integer cents. */
export function parseAmount(value: FormDataEntryValue | null): { cents: number } | { error: string } {
  try {
    const cents = parseCadToCents(String(value ?? ""));
    return cents > 0 ? { cents } : { error: "Enter an amount greater than $0.00" };
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : "Enter a valid amount" };
  }
}

export function FormError({ message }: { message: string }) {
  return message ? <p role="alert" className="rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">{message}</p> : null;
}

export function SubmitButton({ busy, label, className }: { busy: boolean; label: string; className?: string }) {
  return (
    <Button type="submit" disabled={busy} className={cn("flex-1", className)}>
      {busy ? <><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Saving…</> : label}
    </Button>
  );
}
