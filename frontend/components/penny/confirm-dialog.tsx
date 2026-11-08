"use client";

import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dashboard } from "@/lib/api";
import { FormError } from "./form-parts";
import type { Mutate } from "./use-dashboard";

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<string | null>;
};

/** A confirmed delete whose toast offers Undo by re-creating the record. */
export function deleteConfirmation(
  mutate: Mutate,
  options: {
    title: string;
    description: string;
    confirmLabel: string;
    remove: () => Promise<Dashboard>;
    restore: () => Promise<Dashboard>;
    noun: string;
  },
): ConfirmRequest {
  return {
    title: options.title,
    description: `${options.description} You can undo this right after.`,
    confirmLabel: options.confirmLabel,
    onConfirm: () =>
      mutate(options.remove, `${options.noun} deleted`, {
        label: "Undo",
        run: options.restore,
        done: `${options.noun} restored`,
      }),
  };
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {request && <ConfirmBody request={request} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    setError("");
    const message = await request.onConfirm();
    setBusy(false);
    if (message) setError(message);
    else onClose();
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        <DialogDescription>{request.description}</DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          {request.confirmLabel}
        </Button>
      </div>
    </>
  );
}
