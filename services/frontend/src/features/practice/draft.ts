import { useEffect, useState } from "react";

/**
 * What the learner typed into a code editor, kept across navigation.
 *
 * Why it is stored at all: without it, coming back to a lesson you already
 * passed shows an empty editor, and the answer you worked out is simply
 * gone. The lesson's own text is still there to re-read; the thing you
 * actually made is the one part that wasn't.
 *
 * Why in `localStorage` and not with the progress: progress is an additive
 * set of completions — a completion cannot be un-earned, so merging two
 * machines' files can never destroy anything (transfer/import.ts). A draft
 * is a register: edit the same lesson on two machines and one text has to
 * overwrite the other, which would make import capable of deleting work
 * someone typed. A draft is the state of a desk, not a record of what was
 * learned, and it does not travel.
 *
 * The key names the assignment, not the language: a later `python` or
 * `javascript` editor stores its own draft under the same scheme without a
 * second mechanism.
 */
const PREFIX = "trellis.draft";

/** Drafts older than this are dropped on read. A sandbox exercise you last
 * touched three months ago is not work in progress, and the browser's
 * storage quota is shared with everything else this origin keeps. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  readonly text: string;
  /** Epoch milliseconds of the last edit, for the expiry above. */
  readonly savedAt: number;
}

export function draftKey(courseId: string, lessonId: string, slot = "practice"): string {
  return `${PREFIX}:${courseId}:${lessonId}:${slot}`;
}

export function readDraft(key: string): string | undefined {
  // Every access is guarded: `localStorage` throws on access in a browser
  // with site data blocked, and a draft is a convenience — losing it must
  // never take the lesson down with it.
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const draft = parsed as Partial<StoredDraft>;
    if (typeof draft.text !== "string" || typeof draft.savedAt !== "number") {
      return undefined;
    }
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return draft.text;
  } catch {
    return undefined;
  }
}

export function writeDraft(key: string, text: string): void {
  try {
    if (text.trim().length === 0) {
      // An empty editor is not a draft worth keeping — and clearing it is
      // how a learner says "forget what I wrote".
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify({ text, savedAt: Date.now() } satisfies StoredDraft));
  } catch {
    // Quota exceeded, or storage disabled. Nothing to do and nothing to
    // tell the learner: their text is still in the editor.
  }
}

/**
 * `useState` that remembers. Reads the stored draft on mount (lazily, so
 * the read happens once per lesson rather than on every render) and writes
 * every change back.
 *
 * `key` is not passed to `useState` as a dependency because the component
 * that owns an editor is re-mounted per lesson by the router — but the
 * effect below still re-reads if a caller ever keeps one mounted across
 * lessons, which would otherwise show the previous lesson's text.
 */
export function useDraft(key: string): [string, (text: string) => void] {
  const [text, setText] = useState<string>(() => readDraft(key) ?? "");

  useEffect(() => {
    setText(readDraft(key) ?? "");
  }, [key]);

  return [
    text,
    (next: string) => {
      setText(next);
      writeDraft(key, next);
    },
  ];
}
