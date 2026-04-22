import { describe, expect, it, vi } from "vitest";
import { type UploadFinalizeInsertResult, type UploadFinalizePort, handleUploadFinalize } from "@/lib/upload/finalize";
import { MAX_UPLOAD_BYTES, PDF_MAGIC_BYTES } from "@/lib/upload/validate";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE_ID = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const STORAGE_PATH = `${WORKSPACE_ID}/${DOCUMENT_ID}.pdf`;
const PDF_HEAD = Uint8Array.from([...PDF_MAGIC_BYTES, 0x2d, 0x31, 0x2e, 0x37]);

type Insert = Parameters<UploadFinalizePort["insertDocumentRow"]>[0];

type FakeStore = {
  objects: Map<string, { size: number; head: Uint8Array }>;
  deletions: string[];
  inserts: Insert[];
  rowDeletions: string[];
  published: string[];
};

const makeStore = (overrides?: { size?: number; head?: Uint8Array }): FakeStore => {
  const objects = new Map<string, { size: number; head: Uint8Array }>();

  objects.set(STORAGE_PATH, {
    size: overrides?.size ?? 4096,
    head: overrides?.head ?? PDF_HEAD,
  });

  return { objects, deletions: [], inserts: [], rowDeletions: [], published: [] };
};

const makePort = (store: FakeStore, overrides?: Partial<UploadFinalizePort>): UploadFinalizePort => {
  return {
    getAuthContext: async () => {
      return { userId: USER_ID, workspaceId: WORKSPACE_ID };
    },

    checkOrigin: () => {
      return true;
    },

    getObjectSize: async path => {
      const obj = store.objects.get(path);

      return obj === undefined ? null : obj.size;
    },

    getObjectHead: async (path, byteCount) => {
      const obj = store.objects.get(path);

      if (obj === undefined) {
        return null;
      }

      return obj.head.slice(0, byteCount);
    },

    deleteObject: async path => {
      store.deletions.push(path);
      store.objects.delete(path);
    },

    insertDocumentRow: async row => {
      store.inserts.push(row);

      return { ok: true };
    },

    deleteDocumentRow: async documentId => {
      store.rowDeletions.push(documentId);
    },

    publishExtract: async documentId => {
      store.published.push(documentId);
    },

    ...overrides,
  };
};

const buildRequest = (body: unknown): Request => {
  return new Request("http://localhost/api/upload/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

const validBody = () => {
  return { documentId: DOCUMENT_ID, filename: "w2-2026.pdf", storagePath: STORAGE_PATH };
};

describe("handleUploadFinalize — happy path", () => {
  it("inserts a pending row and publishes an extract message when verification passes", async () => {
    const store = makeStore();
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(200);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: true, documentId: DOCUMENT_ID });
    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0]).toMatchObject({
      id: DOCUMENT_ID,
      workspaceId: WORKSPACE_ID,
      uploadedBy: USER_ID,
      filename: "w2-2026.pdf",
      storagePath: STORAGE_PATH,
    });
    expect(store.published).toEqual([DOCUMENT_ID]);
    expect(store.deletions).toEqual([]);
    expect(store.rowDeletions).toEqual([]);
  });
});

describe("handleUploadFinalize — auth and origin", () => {
  it("returns 403 when origin check fails", async () => {
    const store = makeStore();

    const port = makePort(store, {
      checkOrigin: () => {
        return false;
      },
    });

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(403);
    expect(store.inserts).toEqual([]);
    expect(store.published).toEqual([]);
  });

  it("returns 401 when there is no authenticated context", async () => {
    const store = makeStore();

    const port = makePort(store, {
      getAuthContext: async () => {
        return null;
      },
    });

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(401);
    expect(store.inserts).toEqual([]);
  });
});

describe("handleUploadFinalize — payload validation", () => {
  it("rejects non-JSON body", async () => {
    const store = makeStore();
    const port = makePort(store);

    const request = new Request("http://localhost/api/upload/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const response = await handleUploadFinalize(request, port);

    expect(response.status).toBe(400);
    expect(store.inserts).toEqual([]);
  });

  it("rejects a non-UUID documentId", async () => {
    const store = makeStore();
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest({ ...validBody(), documentId: "not-a-uuid" }), port);

    expect(response.status).toBe(400);
    expect(store.inserts).toEqual([]);
  });

  it("does not leak zod issue structure on invalid_payload", async () => {
    const store = makeStore();
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest({ ...validBody(), documentId: "not-a-uuid" }), port);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "invalid_payload" });
  });

  it("rejects a filename that fails server-side validation", async () => {
    const store = makeStore();
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest({ ...validBody(), filename: "../evil.pdf" }), port);

    expect(response.status).toBe(400);
    expect(store.inserts).toEqual([]);
  });

  it("rejects a storagePath whose workspace prefix does not match the caller's workspace", async () => {
    const store = makeStore();

    store.objects.set(`${OTHER_WORKSPACE_ID}/${DOCUMENT_ID}.pdf`, { size: 4096, head: PDF_HEAD });

    const port = makePort(store);

    const response = await handleUploadFinalize(
      buildRequest({
        ...validBody(),
        storagePath: `${OTHER_WORKSPACE_ID}/${DOCUMENT_ID}.pdf`,
      }),
      port
    );

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "forbidden_path" });
    expect(store.inserts).toEqual([]);
    expect(store.deletions).toEqual([]);
  });

  it("rejects a storagePath whose document-id segment does not match the body documentId", async () => {
    const store = makeStore();
    const otherDocumentId = "dddddddd-dddd-4ddd-dddd-dddddddddddd";

    store.objects.set(`${WORKSPACE_ID}/${otherDocumentId}.pdf`, { size: 4096, head: PDF_HEAD });

    const port = makePort(store);

    const response = await handleUploadFinalize(
      buildRequest({
        ...validBody(),
        storagePath: `${WORKSPACE_ID}/${otherDocumentId}.pdf`,
      }),
      port
    );

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "forbidden_path" });
    expect(store.inserts).toEqual([]);
  });
});

describe("handleUploadFinalize — magic-bytes and size verification (security boundary)", () => {
  it("rejects an object whose first bytes are not %PDF and deletes the orphan", async () => {
    const store = makeStore({ head: Uint8Array.from([0x00, 0x00, 0x00, 0x00]) });
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "magic_bytes_mismatch" });
    expect(store.deletions).toEqual([STORAGE_PATH]);
    expect(store.inserts).toEqual([]);
    expect(store.published).toEqual([]);
  });

  it("rejects an oversized object and deletes the orphan", async () => {
    const store = makeStore({ size: MAX_UPLOAD_BYTES + 1 });
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "oversize" });
    expect(store.deletions).toEqual([STORAGE_PATH]);
    expect(store.inserts).toEqual([]);
    expect(store.published).toEqual([]);
  });

  it("rejects a zero-byte object with empty_upload (not oversize) and deletes the orphan", async () => {
    const store = makeStore({ size: 0 });
    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "empty_upload" });
    expect(store.deletions).toEqual([STORAGE_PATH]);
    expect(store.inserts).toEqual([]);
  });

  it("returns storage_object_missing when the storage object does not exist", async () => {
    const store = makeStore();

    store.objects.clear();

    const port = makePort(store);

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(400);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "storage_object_missing" });
    expect(store.inserts).toEqual([]);
  });
});

describe("handleUploadFinalize — insert-failure paths", () => {
  it("treats a duplicate insert as idempotent 200 and does not delete the storage object", async () => {
    // A prior finalize for this (documentId, storagePath) already succeeded.
    // The storage object belongs to that first row — deleting it would corrupt a legitimate document.
    const store = makeStore();

    const port = makePort(store, {
      insertDocumentRow: async () => {
        const result: UploadFinalizeInsertResult = {
          ok: false,
          kind: "duplicate",
          error: "duplicate key value violates unique constraint",
        };

        return result;
      },
    });

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(200);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: true, documentId: DOCUMENT_ID, idempotent: true });
    expect(store.deletions).toEqual([]);
    expect(store.rowDeletions).toEqual([]);
    expect(store.published).toEqual([]);
  });

  it("on a transient insert failure (non-duplicate) returns 500 insert_failed without deleting the storage object", async () => {
    // The storage object is still valid; the operator can retry finalize. Deleting it would
    // force a re-upload for a transient DB blip.
    const store = makeStore();

    const port = makePort(store, {
      insertDocumentRow: async () => {
        const result: UploadFinalizeInsertResult = {
          ok: false,
          kind: "other",
          error: "connection reset",
        };

        return result;
      },
    });

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(500);
    expect(store.deletions).toEqual([]);
    expect(store.rowDeletions).toEqual([]);
    expect(store.published).toEqual([]);
  });
});

describe("handleUploadFinalize — publish-failure rollback", () => {
  it("rolls back the inserted row and deletes the storage object when publishExtract throws", async () => {
    const store = makeStore();

    const port = makePort(store, {
      publishExtract: async () => {
        throw new Error("qstash 503");
      },
    });

    const response = await handleUploadFinalize(buildRequest(validBody()), port);

    expect(response.status).toBe(500);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "publish_failed" });
    expect(store.inserts).toHaveLength(1);
    expect(store.rowDeletions).toEqual([DOCUMENT_ID]);
    expect(store.deletions).toEqual([STORAGE_PATH]);
  });
});

describe("handleUploadFinalize — observable port interactions", () => {
  it("only calls publishExtract after the row insert succeeds", async () => {
    const store = makeStore();

    const insertSpy = vi.fn(async (row: Insert): Promise<UploadFinalizeInsertResult> => {
      store.inserts.push(row);

      return { ok: true };
    });

    const publishSpy = vi.fn(async (documentId: string) => {
      store.published.push(documentId);
    });

    const port = makePort(store, {
      insertDocumentRow: insertSpy,
      publishExtract: publishSpy,
    });

    await handleUploadFinalize(buildRequest(validBody()), port);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy.mock.invocationCallOrder[0]).toBeLessThan(publishSpy.mock.invocationCallOrder[0]);
  });
});
