import { describe, expect, it, vi } from "vitest";
import {
  type FinalizeResult,
  type PutResult,
  USER_MESSAGE_FALLBACK,
  type UploadBatchPort,
  type UploadStage,
  preCheckBatch,
  preCheckFile,
  uploadOne,
  userMessageForCode,
} from "@/lib/upload/client-batch";

type ProgressCall = [UploadStage, number];

const DOCUMENT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const STORAGE_PATH = "ws/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb.pdf";
const SIGNED_URL = "https://storage.example/signed/url?token=abc";

type FileInit = {
  name?: string;
  type?: string;
  size?: number;
};

const makeFile = (init: FileInit = {}): File => {
  const { name = "w2.pdf", type = "application/pdf", size = 2048 } = init;
  const content = new Uint8Array(size);
  const blob = new Blob([content], { type });

  return new File([blob], name, { type });
};

const makePort = (overrides?: Partial<UploadBatchPort>): UploadBatchPort => {
  return {
    signUpload: async () => {
      return {
        ok: true,
        signedUrl: SIGNED_URL,
        token: "abc",
        documentId: DOCUMENT_ID,
        storagePath: STORAGE_PATH,
      };
    },
    putToStorage: async () => {
      return { ok: true };
    },
    finalizeUpload: async () => {
      return { ok: true, documentId: DOCUMENT_ID };
    },
    onProgress: () => {
      return;
    },
    ...overrides,
  };
};

describe("preCheckFile", () => {
  it("returns null for a valid .pdf under 10 MB with correct MIME", () => {
    const result = preCheckFile(makeFile({ name: "w2.pdf", type: "application/pdf", size: 1024 }));

    expect(result).toBeNull();
  });

  it("rejects non-.pdf extensions with non_pdf_extension", () => {
    const result = preCheckFile(makeFile({ name: "w2.txt", type: "text/plain" }));

    expect(result).toEqual({ code: "non_pdf_extension" });
  });

  it("rejects .pdf files with a non-PDF MIME type", () => {
    const result = preCheckFile(makeFile({ name: "w2.pdf", type: "text/plain" }));

    expect(result).toEqual({ code: "non_pdf_mime" });
  });

  it("rejects files larger than 10 MB with client_oversize", () => {
    const oversize = 10 * 1024 * 1024 + 1;
    const result = preCheckFile(makeFile({ size: oversize }));

    expect(result).toEqual({ code: "client_oversize" });
  });

  it("rejects 0-byte files with empty_file", () => {
    const result = preCheckFile(makeFile({ size: 0 }));

    expect(result).toEqual({ code: "empty_file" });
  });

  it("rejects filenames with path separators", () => {
    const result = preCheckFile(makeFile({ name: "../evil.pdf" }));

    expect(result).toEqual({ code: "filename_has_path_separator" });
  });

  it("rejects filenames over 255 characters with filename_too_long", () => {
    const longName = "a".repeat(252) + ".pdf";
    const result = preCheckFile(makeFile({ name: longName }));

    expect(result).toEqual({ code: "filename_too_long" });
  });

  it("rejects filenames containing null bytes with filename_has_null_byte", () => {
    const result = preCheckFile(makeFile({ name: "has\0null.pdf" }));

    expect(result).toEqual({ code: "filename_has_null_byte" });
  });

  it("prefers empty_file over non_pdf_mime so size feedback is accurate for broken files", () => {
    const result = preCheckFile(makeFile({ size: 0, type: "text/plain" }));

    expect(result).toEqual({ code: "empty_file" });
  });
});

describe("preCheckBatch", () => {
  it("accepts every valid file when the batch is within cap", () => {
    const files = Array.from({ length: 5 }, (_, i) => {
      return makeFile({ name: `f${i}.pdf` });
    });

    const result = preCheckBatch(files);

    expect(result.accepted).toHaveLength(5);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects files past the 10-accepted-file cap with too_many_in_batch", () => {
    const files = Array.from({ length: 11 }, (_, i) => {
      return makeFile({ name: `f${i}.pdf` });
    });

    const result = preCheckBatch(files);

    expect(result.accepted).toHaveLength(10);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.code).toBe("too_many_in_batch");
    expect(result.rejected[0]?.file.name).toBe("f10.pdf");
  });

  it("counts only accepted files toward the batch cap (invalid leading files do not consume slots)", () => {
    const files: File[] = [
      makeFile({ name: "bad1.txt", type: "text/plain" }),
      makeFile({ name: "bad2.txt", type: "text/plain" }),
      ...Array.from({ length: 10 }, (_, i) => {
        return makeFile({ name: `good${i}.pdf` });
      }),
    ];

    const result = preCheckBatch(files);

    expect(result.accepted).toHaveLength(10);
    expect(
      result.accepted.map((f: File): string => {
        return f.name;
      })
    ).toEqual([
      "good0.pdf",
      "good1.pdf",
      "good2.pdf",
      "good3.pdf",
      "good4.pdf",
      "good5.pdf",
      "good6.pdf",
      "good7.pdf",
      "good8.pdf",
      "good9.pdf",
    ]);
    expect(
      result.rejected.map((r): string => {
        return r.code;
      })
    ).toEqual(["non_pdf_extension", "non_pdf_extension"]);
  });

  it("preserves rejection order matching input order", () => {
    const files = [
      makeFile({ name: "good.pdf" }),
      makeFile({ name: "bad.txt", type: "text/plain" }),
      makeFile({ name: "huge.pdf", size: 11 * 1024 * 1024 }),
    ];
    const result = preCheckBatch(files);

    expect(
      result.accepted.map((f: File): string => {
        return f.name;
      })
    ).toEqual(["good.pdf"]);
    expect(
      result.rejected.map((r): string => {
        return r.code;
      })
    ).toEqual(["non_pdf_extension", "client_oversize"]);
  });
});

describe("uploadOne — happy path", () => {
  it("returns ok:true with the server-issued documentId and filename when all three steps succeed", async () => {
    const port = makePort();
    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: true, documentId: DOCUMENT_ID, filename: "w2.pdf" });
  });

  it("emits onProgress four times in order: signing -> uploading -> finalizing -> done", async () => {
    const progress = vi.fn<(stage: UploadStage, percent: number) => void>();
    const port = makePort({ onProgress: progress });

    await uploadOne(makeFile(), port);

    expect(progress).toHaveBeenCalledTimes(4);
    expect(
      progress.mock.calls.map((call: ProgressCall): UploadStage => {
        return call[0];
      })
    ).toEqual(["signing", "uploading", "finalizing", "done"]);
  });

  it("passes the server-issued storagePath and token through to putToStorage and finalizeUpload", async () => {
    const putSpy = vi.fn(async (): Promise<PutResult> => {
      return { ok: true };
    });

    const finalizeSpy = vi.fn(async (): Promise<FinalizeResult> => {
      return { ok: true, documentId: DOCUMENT_ID };
    });

    const port = makePort({ putToStorage: putSpy, finalizeUpload: finalizeSpy });
    const file = makeFile({ name: "w2.pdf" });

    await uploadOne(file, port);

    expect(putSpy).toHaveBeenCalledWith("abc", file, STORAGE_PATH);
    expect(finalizeSpy).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      filename: "w2.pdf",
      storagePath: STORAGE_PATH,
    });
  });
});

describe("uploadOne — error paths", () => {
  it("short-circuits when signUpload returns ok:false and does not call put/finalize", async () => {
    const putSpy = vi.fn();
    const finalizeSpy = vi.fn();

    const port = makePort({
      signUpload: async () => {
        return { ok: false, code: "unauthorized" };
      },
      putToStorage: putSpy,
      finalizeUpload: finalizeSpy,
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "unauthorized" });
    expect(putSpy).not.toHaveBeenCalled();
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("short-circuits when putToStorage returns ok:false and does not call finalizeUpload", async () => {
    const finalizeSpy = vi.fn();

    const port = makePort({
      putToStorage: async () => {
        return { ok: false };
      },
      finalizeUpload: finalizeSpy,
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "storage_put_failed" });
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("returns the server error code when finalizeUpload returns ok:false", async () => {
    const port = makePort({
      finalizeUpload: async () => {
        return { ok: false, code: "magic_bytes_mismatch" };
      },
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "magic_bytes_mismatch" });
  });

  it("normalizes thrown errors in signUpload to network_error and logs them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    const port = makePort({
      signUpload: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "network_error" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("normalizes thrown errors in putToStorage to network_error and logs them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    const port = makePort({
      putToStorage: async () => {
        throw new Error("network down");
      },
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "network_error" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("normalizes thrown errors in finalizeUpload to network_error and logs them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    const port = makePort({
      finalizeUpload: async () => {
        throw new Error("network down");
      },
    });

    const result = await uploadOne(makeFile({ name: "w2.pdf" }), port);

    expect(result).toEqual({ ok: false, filename: "w2.pdf", code: "network_error" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("emits a failed progress event when a step fails", async () => {
    const progress = vi.fn<(stage: UploadStage, percent: number) => void>();

    const port = makePort({
      putToStorage: async () => {
        return { ok: false };
      },
      onProgress: progress,
    });

    await uploadOne(makeFile(), port);

    const stages = progress.mock.calls.map((call: ProgressCall): UploadStage => {
      return call[0];
    });

    expect(stages).toContain("failed");
    expect(stages).not.toContain("done");
  });
});

describe("userMessageForCode", () => {
  it("maps magic_bytes_mismatch to a user-legible sentence naming PDF", () => {
    const message = userMessageForCode("magic_bytes_mismatch");

    expect(message.toLowerCase()).toContain("pdf");
  });

  it("returns a specific non-fallback message for every enumerated known code", () => {
    const codes = [
      "forbidden_origin",
      "unauthorized",
      "invalid_json_body",
      "invalid_payload",
      "signed_url_failed",
      "filename_empty",
      "filename_too_long",
      "filename_has_path_separator",
      "filename_has_null_byte",
      "filename_not_pdf",
      "forbidden_path",
      "storage_object_missing",
      "empty_upload",
      "oversize",
      "magic_bytes_mismatch",
      "insert_failed",
      "publish_failed",
      "network_error",
      "storage_put_failed",
      "too_many_in_batch",
      "non_pdf_extension",
      "non_pdf_mime",
      "client_oversize",
      "empty_file",
    ];

    for (const code of codes) {
      const message = userMessageForCode(code);

      expect(message, `code: ${code}`).not.toBe(USER_MESSAGE_FALLBACK);
      expect(message, `code: ${code}`).toMatch(/\S/);
    }
  });

  it("returns the generic fallback for unknown codes", () => {
    const message = userMessageForCode("totally_made_up_code");

    expect(message).toBe(USER_MESSAGE_FALLBACK);
  });
});
