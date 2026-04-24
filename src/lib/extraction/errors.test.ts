import { describe, expect, it } from "vitest";
import {
  ExtractionError,
  type ExtractionErrorKind,
  type GeminiExtractionErrorKind,
  USER_MESSAGE_FALLBACK,
  classifySdkError,
  userMessageForExtractionKind,
} from "@/lib/extraction/errors";

const ALL_KINDS: readonly ExtractionErrorKind[] = [
  "sdk_retryable",
  "sdk_unrecoverable",
  "empty_response",
  "invalid_json",
  "schema_mismatch",
  "pipeline_unknown",
];

const GEMINI_KINDS: readonly GeminiExtractionErrorKind[] = [
  "sdk_retryable",
  "sdk_unrecoverable",
  "empty_response",
  "invalid_json",
  "schema_mismatch",
];

const LEAKY_TOKENS = ["gemini", "generatecontent", "sdk", "schema", "json"];

describe("userMessageForExtractionKind", () => {
  it("returns a retry-oriented message for sdk_retryable without leaking SDK or model names", () => {
    const message = userMessageForExtractionKind("sdk_retryable");

    expect(message).not.toBe(USER_MESSAGE_FALLBACK);
    expect(message.toLowerCase()).toContain("try again");
  });

  it("returns a specific non-fallback message for every enumerated kind, free of leaky tokens", () => {
    for (const kind of ALL_KINDS) {
      const message = userMessageForExtractionKind(kind);

      expect(message, `kind: ${kind}`).not.toBe(USER_MESSAGE_FALLBACK);
      expect(message, `kind: ${kind}`).toMatch(/\S/);

      const lower = message.toLowerCase();
      const stripped = lower.replace(/\s+/g, "");

      for (const token of LEAKY_TOKENS) {
        expect(lower, `kind ${kind} leaks token: ${token}`).not.toContain(token);
        expect(stripped, `kind ${kind} leaks whitespace-split token: ${token}`).not.toContain(token);
      }
    }
  });

  it("returns the generic fallback for unknown kinds", () => {
    const message = userMessageForExtractionKind("totally_made_up_code");

    expect(message).toBe(USER_MESSAGE_FALLBACK);
  });
});

describe("classifySdkError", () => {
  it("treats 5xx server errors as retryable", () => {
    for (const status of [500, 501, 502, 503, 504, 599]) {
      expect(classifySdkError({ status }), `status ${status}`).toBe("sdk_retryable");
    }
  });

  it("treats 408 (request timeout) and 429 (rate limit) as retryable", () => {
    expect(classifySdkError({ status: 408 })).toBe("sdk_retryable");
    expect(classifySdkError({ status: 429 })).toBe("sdk_retryable");
  });

  it("treats client-error statuses as unrecoverable", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(classifySdkError({ status }), `status ${status}`).toBe("sdk_unrecoverable");
    }
  });

  it("treats errors with no HTTP status (connection/timeout/abort) as retryable", () => {
    expect(classifySdkError(new Error("network down"))).toBe("sdk_retryable");
  });

  it("treats errors with a declared-but-undefined status as retryable (future SDK connection-error shape)", () => {
    expect(classifySdkError({ status: undefined })).toBe("sdk_retryable");
  });

  it("treats null and undefined as unrecoverable rather than inviting doomed retries", () => {
    expect(classifySdkError(null)).toBe("sdk_unrecoverable");
    expect(classifySdkError(undefined)).toBe("sdk_unrecoverable");
  });

  it("treats non-object thrown values as unrecoverable", () => {
    expect(classifySdkError("boom")).toBe("sdk_unrecoverable");
    expect(classifySdkError(42)).toBe("sdk_unrecoverable");
  });

  it("treats errors with a non-numeric status field as unrecoverable (strict type guard)", () => {
    expect(classifySdkError({ status: "500" })).toBe("sdk_unrecoverable");
    expect(classifySdkError({ status: null })).toBe("sdk_unrecoverable");
  });
});

describe("ExtractionError", () => {
  it("wraps each gemini-origin kind with the friendly message from the copy map", () => {
    for (const kind of GEMINI_KINDS) {
      const error = new ExtractionError(kind);

      expect(error, `kind: ${kind}`).toBeInstanceOf(Error);
      expect(error.kind, `kind: ${kind}`).toBe(kind);
      expect(error.message, `kind: ${kind}`).toBe(userMessageForExtractionKind(kind));
      expect(error.name).toBe("ExtractionError");
    }
  });

  it("preserves the underlying SDK error via cause so operators can still see the raw failure", () => {
    const underlying = new Error("original sdk failure");
    const error = new ExtractionError("sdk_retryable", { cause: underlying });

    expect(error.cause).toBe(underlying);
    expect(error.message.toLowerCase()).toContain("try again");
  });
});
