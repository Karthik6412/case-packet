"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A form button that disables itself and shows progress while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant}`} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
