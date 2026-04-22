import { describe, expect, it, vi } from "vitest";
import {
  type DocumentSnapshot,
  type DocumentStatus,
  type ExtractFn,
  type ExtractionDataPort,
  type FinalizedStatus,
  PipelineFailedError,
  runExtractPipeline,
} from "@/lib/extract/pipeline";
import type { ExtractionResult } from "@/lib/extraction/types";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DOCUMENT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const STORAGE_PATH = `${WORKSPACE_ID}/${DOCUMENT_ID}.pdf`;
const DOC_TYPE_THRESHOLD = 0.7;

const w2Result: ExtractionResult = {
  doc_type: "w2",
  doc_type_confidence: 0.95,
  fields: {
    employee_ssn: { value: "123-45-6789", confidence: 0.9 },
    employer_ein: { value: "12-3456789", confidence: 0.92 },
    employer_name: { value: "Acme Corp", confidence: 0.99 },
    employee_name: { value: "Jane Doe", confidence: 0.98 },
    wages: { value: 75000, confidence: 0.97 },
    federal_income_tax_withheld: { value: 9000, confidence: 0.96 },
    social_security_wages: { value: 75000, confidence: 0.97 },
    social_security_tax_withheld: { value: 4650, confidence: 0.96 },
    medicare_wages: { value: 75000, confidence: 0.97 },
    medicare_tax_withheld: { value: 1087.5, confidence: 0.96 },
  },
};

const unknownResult: ExtractionResult = {
  doc_type: "unknown",
  doc_type_confidence: 0.3,
  fields: null,
};

type FakeRow = {
  snapshot: DocumentSnapshot;
  writes: Array<{ status: FinalizedStatus; data: ExtractionResult | null; errorMessage: string | null }>;
};

type FakeStore = {
  documents: Map<string, FakeRow>;
  storageObjects: Map<string, Uint8Array>;
};

const makeStore = (overrides?: Partial<Omit<DocumentSnapshot, "id">> & { status?: DocumentStatus }): FakeStore => {
  const documents = new Map<string, FakeRow>();

  documents.set(DOCUMENT_ID, {
    snapshot: {
      id: DOCUMENT_ID,
      workspaceId: overrides?.workspaceId ?? WORKSPACE_ID,
      storagePath: overrides?.storagePath ?? STORAGE_PATH,
      status: overrides?.status ?? "pending",
    },
    writes: [],
  });

  const storageObjects = new Map<string, Uint8Array>();

  storageObjects.set(STORAGE_PATH, new Uint8Array([0x25, 0x50, 0x44, 0x46]));

  return { documents, storageObjects };
};

const makePort = (store: FakeStore): ExtractionDataPort => {
  return {
    loadDocument: async documentId => {
      const row = store.documents.get(documentId);

      return row === undefined ? null : { ...row.snapshot };
    },

    claimForProcessing: async documentId => {
      const row = store.documents.get(documentId);

      if (row === undefined || row.snapshot.status !== "pending") {
        return false;
      }

      row.snapshot = { ...row.snapshot, status: "processing" };

      return true;
    },

    downloadPdf: async storagePath => {
      const bytes = store.storageObjects.get(storagePath);

      if (bytes === undefined) {
        throw new Error(`Storage object ${storagePath} not found`);
      }

      return bytes;
    },

    writeResult: async (documentId, status, data, errorMessage) => {
      const row = store.documents.get(documentId);

      if (row === undefined) {
        throw new Error(`writeResult: document ${documentId} not found`);
      }

      row.writes.push({ status, data, errorMessage });
      row.snapshot = { ...row.snapshot, status };
    },
  };
};

describe("runExtractPipeline — idempotent claim (critical correctness property)", () => {
  it("handles simultaneous duplicate deliveries: exactly one Gemini call, exactly one terminal write", async () => {
    const store = makeStore();
    const port = makePort(store);

    let extractCallCount = 0;

    const extract: ExtractFn = vi.fn(async () => {
      extractCallCount += 1;

      return w2Result;
    });

    const results = await Promise.allSettled([
      runExtractPipeline({ port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD }, { documentId: DOCUMENT_ID }),
      runExtractPipeline({ port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD }, { documentId: DOCUMENT_ID }),
    ]);

    expect(
      results.every(r => {
        return r.status === "fulfilled";
      })
    ).toBe(true);

    const kinds = results
      .flatMap(r => {
        return r.status === "fulfilled" ? [r.value.kind] : [];
      })
      .sort();

    expect(kinds).toEqual(["already_processed", "complete"]);
    expect(extractCallCount).toBe(1);

    const row = store.documents.get(DOCUMENT_ID);

    expect(row?.writes).toHaveLength(1);
    expect(row?.writes[0]?.status).toBe("complete");
  });

  it("sequential re-delivery of the same documentId is a no-op after success", async () => {
    const store = makeStore();
    const port = makePort(store);

    const extract: ExtractFn = vi.fn(async () => {
      return w2Result;
    });

    const first = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );
    const second = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(first).toEqual({ kind: "complete", finalStatus: "complete" });
    expect(second.kind).toBe("already_processed");

    if (second.kind === "already_processed") {
      expect(second.status).toBe("complete");
    }

    expect(extract).toHaveBeenCalledTimes(1);
  });
});

describe("runExtractPipeline — happy path status transitions", () => {
  const makeExtractStub = (result: ExtractionResult): ExtractFn => {
    return vi.fn(async (): Promise<ExtractionResult> => {
      return result;
    });
  };

  it("writes status='complete' on a confident, known doc_type", async () => {
    const store = makeStore();
    const port = makePort(store);
    const extract = makeExtractStub(w2Result);

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "complete", finalStatus: "complete" });

    const row = store.documents.get(DOCUMENT_ID);

    expect(row?.writes).toHaveLength(1);
    expect(row?.writes[0]?.status).toBe("complete");
    expect(row?.writes[0]?.data).toEqual(w2Result);
    expect(row?.writes[0]?.errorMessage).toBeNull();
  });

  it("writes status='needs_review' when doc_type='unknown'", async () => {
    const store = makeStore();
    const port = makePort(store);
    const extract = makeExtractStub(unknownResult);

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "complete", finalStatus: "needs_review" });

    const row = store.documents.get(DOCUMENT_ID);

    expect(row?.writes[0]?.status).toBe("needs_review");
  });

  it("writes status='needs_review' when doc_type_confidence is below the threshold", async () => {
    const store = makeStore();
    const port = makePort(store);
    const lowConfidence: ExtractionResult = { ...w2Result, doc_type_confidence: 0.55 };
    const extract = makeExtractStub(lowConfidence);

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "complete", finalStatus: "needs_review" });
  });

  it("treats confidence exactly at the threshold as complete", async () => {
    const store = makeStore();
    const port = makePort(store);
    const exactlyAtThreshold: ExtractionResult = { ...w2Result, doc_type_confidence: DOC_TYPE_THRESHOLD };
    const extract = makeExtractStub(exactlyAtThreshold);

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "complete", finalStatus: "complete" });
  });
});

describe("runExtractPipeline — already-processed terminal states", () => {
  it("returns already_processed without calling Gemini when row is already 'complete'", async () => {
    const store = makeStore({ status: "complete" });
    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "already_processed", status: "complete" });
    expect(extract).not.toHaveBeenCalled();
    expect(store.documents.get(DOCUMENT_ID)?.writes).toHaveLength(0);
  });

  it("returns already_processed without calling Gemini when row is already 'failed'", async () => {
    const store = makeStore({ status: "failed" });
    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome.kind).toBe("already_processed");
    expect(extract).not.toHaveBeenCalled();
  });

  it("returns already_processed when row is already 'needs_review'", async () => {
    const store = makeStore({ status: "needs_review" });
    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome.kind).toBe("already_processed");
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("runExtractPipeline — authorization", () => {
  it("returns unauthorized(document_not_found) when the row does not exist", async () => {
    const store = makeStore();

    store.documents.clear();

    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "unauthorized", reason: "document_not_found" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("returns unauthorized(storage_path_mismatch) when storage_path does not equal {workspace_id}/{document_id}.pdf", async () => {
    const store = makeStore({ storagePath: "different-workspace/bogus.pdf" });
    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "unauthorized", reason: "storage_path_mismatch" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects a row whose workspace_id is not a UUID", async () => {
    const store = makeStore({ workspaceId: "not-a-uuid" });
    const port = makePort(store);
    const extract: ExtractFn = vi.fn();

    const outcome = await runExtractPipeline(
      { port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
      { documentId: DOCUMENT_ID }
    );

    expect(outcome).toEqual({ kind: "unauthorized", reason: "storage_path_mismatch" });
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("runExtractPipeline — extraction failures", () => {
  it("writes 'failed' and rethrows PipelineFailedError when extract throws", async () => {
    const store = makeStore();
    const port = makePort(store);
    const extractError = new Error("Gemini 429");

    const extract: ExtractFn = vi.fn(async () => {
      throw extractError;
    });

    await expect(
      runExtractPipeline({ port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD }, { documentId: DOCUMENT_ID })
    ).rejects.toBeInstanceOf(PipelineFailedError);

    const row = store.documents.get(DOCUMENT_ID);

    expect(row?.writes).toHaveLength(1);
    expect(row?.writes[0]?.status).toBe("failed");
    expect(row?.writes[0]?.data).toBeNull();
    expect(row?.writes[0]?.errorMessage).toBe("Gemini 429");
    expect(row?.snapshot.status).toBe("failed");
  });

  it("writes 'failed' when the storage download throws", async () => {
    const store = makeStore();
    const port = makePort(store);

    store.storageObjects.clear();

    const extract: ExtractFn = vi.fn();

    await expect(
      runExtractPipeline({ port, extract, docTypeThreshold: DOC_TYPE_THRESHOLD }, { documentId: DOCUMENT_ID })
    ).rejects.toBeInstanceOf(PipelineFailedError);

    const row = store.documents.get(DOCUMENT_ID);

    expect(row?.writes[0]?.status).toBe("failed");
    expect(row?.writes[0]?.errorMessage).toContain("Storage object");
    expect(extract).not.toHaveBeenCalled();
  });

  it("still throws PipelineFailedError even if the failure-path writer also throws", async () => {
    const store = makeStore();
    const originalPort = makePort(store);

    const brokenPort: ExtractionDataPort = {
      ...originalPort,
      writeResult: async () => {
        throw new Error("writer down");
      },
    };

    const extract: ExtractFn = vi.fn(async () => {
      throw new Error("Gemini 500");
    });

    await expect(
      runExtractPipeline(
        { port: brokenPort, extract, docTypeThreshold: DOC_TYPE_THRESHOLD },
        { documentId: DOCUMENT_ID }
      )
    ).rejects.toBeInstanceOf(PipelineFailedError);
  });
});
