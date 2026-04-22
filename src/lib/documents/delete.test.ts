import { describe, expect, it, vi } from "vitest";
import { type DocumentDeletePort, type RemoveStorageResult, handleDocumentDelete } from "@/lib/documents/delete";

const WORKSPACE_A = "11111111-1111-4111-a111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DOC_ID = "dddddddd-dddd-4ddd-bddd-dddddddddddd";
const STORAGE_PATH = `workspaces/${WORKSPACE_A}/${DOC_ID}.pdf`;

const sameOriginRequest = (): Request => {
  return new Request("https://app.example/api/documents/" + DOC_ID, {
    method: "DELETE",
    headers: { origin: "https://app.example" },
  });
};

const makePort = (overrides?: Partial<DocumentDeletePort>): DocumentDeletePort => {
  return {
    getAuthContext: async () => {
      return { userId: USER_A, workspaceId: WORKSPACE_A, email: null };
    },
    checkOrigin: () => {
      return true;
    },
    loadDocument: async () => {
      return { id: DOC_ID, workspaceId: WORKSPACE_A, storagePath: STORAGE_PATH };
    },
    isWorkspaceMember: async () => {
      return true;
    },
    removeStorageObject: async () => {
      return { ok: true };
    },
    deleteDocumentRow: async () => {
      return { ok: true };
    },
    ...overrides,
  };
};

describe("handleDocumentDelete", () => {
  it("returns 204 on the happy path", async () => {
    const port = makePort();

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(204);
  });

  it("calls removeStorageObject before deleteDocumentRow", async () => {
    const calls: string[] = [];

    const port = makePort({
      removeStorageObject: async () => {
        calls.push("storage");

        return { ok: true };
      },
      deleteDocumentRow: async () => {
        calls.push("row");

        return { ok: true };
      },
    });

    await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(calls).toEqual(["storage", "row"]);
  });

  it("treats Storage not_found as success and still deletes the row", async () => {
    const deleteRow = vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      return { ok: true };
    });

    const port = makePort({
      removeStorageObject: async (): Promise<RemoveStorageResult> => {
        return { ok: false, kind: "not_found", error: "object missing" };
      },
      deleteDocumentRow: deleteRow,
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(204);
    expect(deleteRow).toHaveBeenCalledOnce();
  });

  it("returns 403 when origin check fails", async () => {
    const port = makePort({
      checkOrigin: () => {
        return false;
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).toEqual({ error: "forbidden_origin" });
  });

  it("returns 401 when auth context is null", async () => {
    const port = makePort({
      getAuthContext: async () => {
        return null;
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(401);
  });

  it("returns 404 when the document does not exist", async () => {
    const port = makePort({
      loadDocument: async () => {
        return null;
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 404 (not 403) when the document belongs to a different workspace", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_B, storagePath: STORAGE_PATH };
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 404 when the auth context is not a workspace member", async () => {
    const port = makePort({
      isWorkspaceMember: async () => {
        return false;
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 500 and does NOT delete the row when storage remove fails non-recoverably", async () => {
    const deleteRow = vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      return { ok: true };
    });

    const port = makePort({
      removeStorageObject: async (): Promise<RemoveStorageResult> => {
        return { ok: false, kind: "other", error: "storage exploded" };
      },
      deleteDocumentRow: deleteRow,
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(500);
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("returns 500 when row delete fails after storage remove succeeds", async () => {
    const port = makePort({
      removeStorageObject: async () => {
        return { ok: true };
      },
      deleteDocumentRow: async () => {
        return { ok: false, error: "db boom" };
      },
    });

    const response = await handleDocumentDelete(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    expect(body).toEqual({ error: "db_error" });
  });

  it("returns 400 when the document id is not a valid uuid", async () => {
    const port = makePort();

    const response = await handleDocumentDelete(sameOriginRequest(), "not-a-uuid", port);

    expect(response.status).toBe(400);
  });
});
