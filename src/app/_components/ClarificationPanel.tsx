"use client";

import { useId, useState } from "react";

/**
 * "Request clarification": previews the message that would go to the client.
 * Sending is planned, so the send control is disabled and nothing is sent.
 * Renders the toggle button and, when open, a full-width preview beside it.
 */
export function ClarificationPanel({
  subject,
  body,
  emphasized,
}: {
  subject: string;
  body: string;
  emphasized: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <div className="action">
        <button
          type="button"
          className={`btn ${emphasized ? "btn-primary" : "btn-secondary"}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          Request clarification
        </button>
        <p className="hint">Preview a message to the client.</p>
      </div>
      <section id={panelId} className="preview" hidden={!open} aria-label="Message preview">
        <p className="preview-label">Preview of message to the client</p>
        <p className="preview-subject">
          <strong>Subject:</strong> {subject}
        </p>
        <p className="preview-body">{body}</p>
        <div className="preview-actions">
          <button type="button" className="btn btn-secondary" disabled>
            Send to client (planned)
          </button>
          <p className="hint">Sending is planned and is not available yet. Nothing has been sent.</p>
        </div>
      </section>
    </>
  );
}
