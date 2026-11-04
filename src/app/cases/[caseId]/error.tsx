"use client";

import { useEffect } from "react";

export default function CaseError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="card" role="alert">
      <h1>Something went wrong</h1>
      <p>This case could not be updated. Nothing was lost; earlier runs are unchanged.</p>
      <button type="button" className="btn btn-primary" onClick={() => retry()}>
        Try again
      </button>
    </section>
  );
}
