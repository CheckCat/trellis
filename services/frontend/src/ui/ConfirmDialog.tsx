import { useEffect, useRef } from "react";

/**
 * A modal that asks before something irreversible happens. Right now there
 * is exactly one caller («Перепройти курс»), and it stays a shared
 * component anyway because the next destructive action must not invent its
 * own confirmation manners.
 *
 * Not a native `<dialog>`: `showModal()` is not implemented in jsdom, so
 * every test of a screen that opens one would have to stub it — and the two
 * things `<dialog>` gives here (the top layer and Esc) are a `position:
 * fixed` overlay and four lines of key handling. Focus is moved to the
 * cancel button on open so the keyboard lands on the safe choice, and
 * because a dialog nobody focused is one a screen reader never announces.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Отмена",
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    // Clicking the backdrop cancels — the same escape hatch as Esc, and the
    // only thing the backdrop is for. The panel stops the click so a click
    // that lands inside the dialog is never read as "get me out of here".
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button type="button" className="button button--quiet" ref={cancelRef} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          {/* The destructive choice is the one that looks destructive, and
           * it is not the one holding focus. */}
          <button type="button" className="button button--danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
