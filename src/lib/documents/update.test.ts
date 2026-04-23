import { describe, expect, it, vi } from "vitest";
import { type DocumentUpdatePort, type UpdateWriteResult, handleDocumentUpdate } from "@/lib/documents/update";

const WORKSPACE_A = "11111111-1111-4111-a111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DOC_ID = "dddddddd-dddd-4ddd-bddd-dddddddddddd";

const patchRequest = (body: unknown): Request => {
  return new Request(`https://app.example/api/documents/${DOC_ID}`, {
    method: "PATCH",
    headers: { "origin": "https://app.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

const makePort = (overrides?: Partial<DocumentUpdatePort>): DocumentUpdatePort => {
  return {
    getAuthContext: async () => {
      return { userId: USER_A, workspaceId: WORKSPACE_A };
    },
    checkOrigin: () => {
      return true;
    },
    loadDocument: async () => {
      return { id: DOC_ID, workspaceId: WORKSPACE_A, status: "complete", docType: "w2" };
    },
    saveEdit: async () => {
      return { ok: true };
    },
    saveNeedsReviewComplete: async () => {
      return { ok: true };
    },
    ...overrides,
  };
};

const validEditBody = {
  action: "edit",
  extracted_data: {
    wages: { value: 1000, confidence: 0.9 },
    employee_ssn: { value: "123-45-6789", confidence: 1 },
  },
  edited_fields: { wages: true },
};

const validNeedsReviewBody = {
  action: "complete_from_needs_review",
  doc_type: "w2",
  extracted_data: {
    wages: { value: 0, confidence: 1 },
  },
};

describe("handleDocumentUpdate — edit action", () => {
  it("returns 200 on the happy path", async () => {
    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, makePort());

    expect(response.status).toBe(200);
  });

  it("passes extracted_data and edited_fields verbatim to saveEdit", async () => {
    const save = vi.fn(async (): Promise<UpdateWriteResult> => {
      return { ok: true };
    });

    const port = makePort({ saveEdit: save });

    await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(save).toHaveBeenCalledWith(DOC_ID, validEditBody.extracted_data, validEditBody.edited_fields);
  });

  it("returns 409 when editing a non-complete row (e.g. pending)", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_A, status: "pending", docType: null };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(409);
  });

  it("returns 409 with conflict_status_changed when the row's status changes between loadDocument and UPDATE (TOCTOU)", async () => {
    const port = makePort({
      saveEdit: async () => {
        return { ok: false, kind: "conflict" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(409);

    const body: unknown = await response.json();

    if (typeof body !== "object" || body === null || !("error" in body)) {
      throw new Error("unexpected body");
    }

    expect(body.error).toBe("conflict_status_changed");
  });

  it("returns 500 when the DB save fails with a transport error", async () => {
    const port = makePort({
      saveEdit: async () => {
        return { ok: false, kind: "error", error: "rls_policy_denied" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(500);
  });

  it("returns 400 when extracted_data contains a key outside the doc_type allow-list", async () => {
    const body = {
      action: "edit",
      extracted_data: {
        wages: { value: 1000, confidence: 0.9 },
        malicious_field: { value: "nope", confidence: 1 },
      },
      edited_fields: {},
    };

    const response = await handleDocumentUpdate(patchRequest(body), DOC_ID, makePort());

    expect(response.status).toBe(400);

    const parsed: unknown = await response.json();

    if (typeof parsed !== "object" || parsed === null || !("error" in parsed) || !("fields" in parsed)) {
      throw new Error("unexpected body");
    }

    expect(parsed.error).toBe("unknown_fields");
  });

  it("returns 400 when edited_fields contains a key outside the doc_type allow-list", async () => {
    const body = {
      ...validEditBody,
      edited_fields: { wages: true, ghost_field: true },
    };

    const response = await handleDocumentUpdate(patchRequest(body), DOC_ID, makePort());

    expect(response.status).toBe(400);
  });

  it("returns 409 when the row is complete but its doc_type is null (malformed state)", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_A, status: "complete", docType: null };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(409);
  });

  it("caps string values at 500 characters (Zod refusal, defense-in-depth against payload bloat)", async () => {
    const body = {
      action: "edit",
      extracted_data: {
        employee_ssn: { value: "x".repeat(501), confidence: 1 },
      },
      edited_fields: {},
    };

    const response = await handleDocumentUpdate(patchRequest(body), DOC_ID, makePort());

    expect(response.status).toBe(400);
  });
});

describe("handleDocumentUpdate — complete_from_needs_review action", () => {
  const needsReviewPort = (overrides?: Partial<DocumentUpdatePort>): DocumentUpdatePort => {
    return makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_A, status: "needs_review", docType: null };
      },
      ...overrides,
    });
  };

  it("returns 200 on the happy path", async () => {
    const response = await handleDocumentUpdate(patchRequest(validNeedsReviewBody), DOC_ID, needsReviewPort());

    expect(response.status).toBe(200);
  });

  it("returns 409 when called on a non-needs_review row (e.g. complete)", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_A, status: "complete", docType: "w2" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validNeedsReviewBody), DOC_ID, port);

    expect(response.status).toBe(409);
  });

  it("returns 409 when the row's status changes between loadDocument and UPDATE (TOCTOU)", async () => {
    const port = needsReviewPort({
      saveNeedsReviewComplete: async () => {
        return { ok: false, kind: "conflict" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validNeedsReviewBody), DOC_ID, port);

    expect(response.status).toBe(409);
  });

  it("returns 500 when the DB save fails with a transport error", async () => {
    const port = needsReviewPort({
      saveNeedsReviewComplete: async () => {
        return { ok: false, kind: "error", error: "rls_policy_denied" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validNeedsReviewBody), DOC_ID, port);

    expect(response.status).toBe(500);
  });

  it("calls saveNeedsReviewComplete (not saveEdit)", async () => {
    const saveEdit = vi.fn(async (): Promise<UpdateWriteResult> => {
      return { ok: true };
    });

    const saveNeedsReview = vi.fn(async (): Promise<UpdateWriteResult> => {
      return { ok: true };
    });

    const port = needsReviewPort({ saveEdit, saveNeedsReviewComplete: saveNeedsReview });

    await handleDocumentUpdate(patchRequest(validNeedsReviewBody), DOC_ID, port);

    expect(saveEdit).not.toHaveBeenCalled();
    expect(saveNeedsReview).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported doc_type at the Zod boundary", async () => {
    const body = { ...validNeedsReviewBody, doc_type: "unknown" };

    const response = await handleDocumentUpdate(patchRequest(body), DOC_ID, needsReviewPort());

    expect(response.status).toBe(400);
  });

  it("returns 400 when extracted_data contains a key outside the picked doc_type", async () => {
    const body = {
      action: "complete_from_needs_review",
      doc_type: "w2",
      extracted_data: {
        wages: { value: 0, confidence: 1 },
        rents: { value: 0, confidence: 1 },
      },
    };

    const response = await handleDocumentUpdate(patchRequest(body), DOC_ID, needsReviewPort());

    expect(response.status).toBe(400);
  });
});

describe("handleDocumentUpdate — cross-cutting checks", () => {
  it("returns 403 when the origin check fails", async () => {
    const port = makePort({
      checkOrigin: () => {
        return false;
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(403);
  });

  it("returns 400 when the document id is not a UUID", async () => {
    const response = await handleDocumentUpdate(patchRequest(validEditBody), "not-a-uuid", makePort());

    expect(response.status).toBe(400);
  });

  it("returns 401 when auth is missing", async () => {
    const port = makePort({
      getAuthContext: async () => {
        return null;
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    const request = new Request(`https://app.example/api/documents/${DOC_ID}`, {
      method: "PATCH",
      headers: { "origin": "https://app.example", "content-type": "application/json" },
      body: "this is not json",
    });

    const response = await handleDocumentUpdate(request, DOC_ID, makePort());

    expect(response.status).toBe(400);
  });

  it("returns 400 on a payload missing the action discriminator", async () => {
    const response = await handleDocumentUpdate(patchRequest({ extracted_data: {} }), DOC_ID, makePort());

    expect(response.status).toBe(400);
  });

  it("returns 404 (not 403) on a cross-workspace document (no cross-tenant leak)", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_B, status: "complete", docType: "w2" };
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 404 when the document is not found", async () => {
    const port = makePort({
      loadDocument: async () => {
        return null;
      },
    });

    const response = await handleDocumentUpdate(patchRequest(validEditBody), DOC_ID, port);

    expect(response.status).toBe(404);
  });
});
