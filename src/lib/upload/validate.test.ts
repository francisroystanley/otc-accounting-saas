import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  hasPdfMagicBytes,
  isWithinSizeLimit,
  storagePathForDocument,
  validateFilename,
} from "@/lib/upload/validate";

describe("validateFilename", () => {
  it("accepts a plain .pdf filename", () => {
    expect(validateFilename("w2-2026.pdf")).toBeNull();
  });

  it("accepts uppercase extension", () => {
    expect(validateFilename("w2-2026.PDF")).toBeNull();
  });

  it("rejects empty filename", () => {
    expect(validateFilename("")).toBe("filename_empty");
  });

  it("rejects filename longer than 255 characters", () => {
    expect(validateFilename(`${"a".repeat(252)}.pdf`)).toBe("filename_too_long");
  });

  it("rejects forward-slash path separators", () => {
    expect(validateFilename("../evil.pdf")).toBe("filename_has_path_separator");
    expect(validateFilename("a/b.pdf")).toBe("filename_has_path_separator");
  });

  it("rejects backslash path separators", () => {
    expect(validateFilename("a\\b.pdf")).toBe("filename_has_path_separator");
  });

  it("rejects embedded null byte", () => {
    expect(validateFilename("safe.pdf\0.exe")).toBe("filename_has_null_byte");
  });

  it("rejects non-.pdf extensions", () => {
    expect(validateFilename("w2.txt")).toBe("filename_not_pdf");
    expect(validateFilename("w2")).toBe("filename_not_pdf");
    expect(validateFilename(".pdfx")).toBe("filename_not_pdf");
  });
});

describe("hasPdfMagicBytes", () => {
  it("returns true for bytes starting with %PDF", () => {
    expect(hasPdfMagicBytes(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
  });

  it("returns false when first four bytes are different", () => {
    expect(hasPdfMagicBytes(Uint8Array.from([0x25, 0x50, 0x44, 0x47]))).toBe(false);
  });

  it("returns false for a buffer shorter than four bytes", () => {
    expect(hasPdfMagicBytes(Uint8Array.from([0x25, 0x50, 0x44]))).toBe(false);
  });

  it("returns false for an empty buffer", () => {
    expect(hasPdfMagicBytes(new Uint8Array(0))).toBe(false);
  });
});

describe("isWithinSizeLimit", () => {
  it("accepts 1 byte", () => {
    expect(isWithinSizeLimit(1)).toBe(true);
  });

  it("accepts exactly MAX_UPLOAD_BYTES", () => {
    expect(isWithinSizeLimit(MAX_UPLOAD_BYTES)).toBe(true);
  });

  it("rejects zero", () => {
    expect(isWithinSizeLimit(0)).toBe(false);
  });

  it("rejects values above the limit", () => {
    expect(isWithinSizeLimit(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isWithinSizeLimit(Number.NaN)).toBe(false);
    expect(isWithinSizeLimit(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("storagePathForDocument", () => {
  it("joins workspace and document IDs with a .pdf suffix", () => {
    expect(storagePathForDocument("ws-1", "doc-1")).toBe("ws-1/doc-1.pdf");
  });
});
