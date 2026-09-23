import { ApiError } from "../api/client";

/**
 * The message an API error carries, or a generic fallback when the failure
 * was not an `ApiError` at all (a network failure, an unexpected exception
 * `apiFetch` did not shape). Every error-driven `<p className="muted-note">`
 * in this app follows this same rule — factored out so the wording only
 * needs to be right in one place.
 */
export function formatApiError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
