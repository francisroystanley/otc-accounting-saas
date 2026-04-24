export type ExtractionErrorKind =
  | "sdk_retryable"
  | "sdk_unrecoverable"
  | "empty_response"
  | "invalid_json"
  | "schema_mismatch"
  | "pipeline_unknown";

// Excludes "pipeline_unknown" — that kind is looked up by pipeline.ts when it
// catches a non-ExtractionError; it's never carried on a thrown ExtractionError.
export type GeminiExtractionErrorKind = Exclude<ExtractionErrorKind, "pipeline_unknown">;

export const PIPELINE_UNKNOWN_KIND: ExtractionErrorKind = "pipeline_unknown";

const USER_MESSAGES: Readonly<Record<ExtractionErrorKind, string>> = {
  sdk_retryable:
    "Temporary issue reaching the extraction service. Try again in a moment; contact support if it keeps happening.",
  sdk_unrecoverable:
    "Couldn't process this PDF. Try re-uploading a clearer copy, or contact support if the file looks fine.",
  empty_response: "The extraction service couldn't read this PDF. Try re-uploading a clearer copy.",
  invalid_json: "Couldn't process this PDF. Try re-uploading; contact support if it keeps happening.",
  schema_mismatch:
    "Couldn't read this document's fields. The format may be unusual — try a clearer copy or contact support.",
  pipeline_unknown: "Extraction failed. Try again; contact support if this keeps happening.",
};

export const USER_MESSAGE_FALLBACK = "Extraction failed. Please try again.";

const isExtractionErrorKind = (kind: string): kind is ExtractionErrorKind => {
  return Object.prototype.hasOwnProperty.call(USER_MESSAGES, kind);
};

export function userMessageForExtractionKind(kind: ExtractionErrorKind): string;
export function userMessageForExtractionKind(kind: string): string;

export function userMessageForExtractionKind(kind: string): string {
  if (!isExtractionErrorKind(kind)) {
    return USER_MESSAGE_FALLBACK;
  }

  return USER_MESSAGES[kind];
}

/**
 * Typed error thrown by the Gemini extraction boundary. The `message` is
 * auto-derived from `USER_MESSAGES` keyed by `kind` and is written verbatim
 * to `documents.error_message`, then rendered in the UI. Callers do not pass
 * a custom message — pass the raw SDK/Zod error via `options.cause` so it
 * remains visible to operators in server logs.
 */
export class ExtractionError extends Error {
  readonly kind: GeminiExtractionErrorKind;

  constructor(kind: GeminiExtractionErrorKind, options?: ErrorOptions) {
    super(userMessageForExtractionKind(kind), options);
    this.name = "ExtractionError";
    this.kind = kind;
  }
}

const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429]);

export const classifySdkError = (error: unknown): "sdk_retryable" | "sdk_unrecoverable" => {
  if (typeof error !== "object" || error === null) {
    return "sdk_unrecoverable";
  }

  if (!("status" in error)) {
    // Connection/timeout/abort errors from @google/genai carry no HTTP status.
    // Treat them as retryable so the user is guided to try again.
    return "sdk_retryable";
  }

  const { status } = error;

  if (status === undefined) {
    // Same intent as "no status property at all" — future SDK versions may
    // declare status as an own property and leave it undefined on connection
    // errors. Treat as retryable rather than unrecoverable.
    return "sdk_retryable";
  }

  if (typeof status !== "number") {
    return "sdk_unrecoverable";
  }

  if (RETRYABLE_HTTP_STATUSES.has(status) || status >= 500) {
    return "sdk_retryable";
  }

  return "sdk_unrecoverable";
};
