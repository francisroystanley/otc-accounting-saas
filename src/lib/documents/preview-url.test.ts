import { describe, expect, it } from "vitest";
import { PREVIEW_URL_TTL_SECONDS, type PreviewUrlPort, handlePreviewUrl } from "@/lib/documents/preview-url";

const WORKSPACE_A = "11111111-1111-4111-a111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const DOC_ID = "dddddddd-dddd-4ddd-bddd-dddddddddddd";
const STORAGE_PATH = `${WORKSPACE_A}/${DOC_ID}.pdf`;

const sameOriginRequest = (): Request => {
  return new Request(`https://app.example/api/documents/${DOC_ID}/preview-url`, {
    method: "GET",
    headers: { origin: "https://app.example" },
  });
};

const makePort = (overrides?: Partial<PreviewUrlPort>): PreviewUrlPort => {
  return {
    getAuthContext: async () => {
      return { userId: USER_A, workspaceId: WORKSPACE_A };
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
    createSignedReadUrl: async () => {
      return "https://storage.example/signed-url";
    },
    ...overrides,
  };
};

describe("handlePreviewUrl", () => {
  it("returns 200 with a signed URL on the happy path", async () => {
    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, makePort());

    expect(response.status).toBe(200);

    const body: unknown = await response.json();

    if (typeof body !== "object" || body === null || !("signedUrl" in body) || !("expiresInSeconds" in body)) {
      throw new Error("unexpected response body shape");
    }

    expect(body.signedUrl).toBe("https://storage.example/signed-url");
    expect(body.expiresInSeconds).toBe(PREVIEW_URL_TTL_SECONDS);
  });

  it("requests a 15-minute TTL from the storage adapter", async () => {
    let observedTtl = -1;

    const port = makePort({
      createSignedReadUrl: async (_path, ttl) => {
        observedTtl = ttl;

        return "https://storage.example/signed-url";
      },
    });

    await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(observedTtl).toBe(60 * 15);
  });

  it("returns 403 when the origin check fails", async () => {
    const port = makePort({
      checkOrigin: () => {
        return false;
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(403);
  });

  it("returns 400 when the document id is not a UUID", async () => {
    const response = await handlePreviewUrl(sameOriginRequest(), "not-a-uuid", makePort());

    expect(response.status).toBe(400);
  });

  it("returns 401 when auth is missing", async () => {
    const port = makePort({
      getAuthContext: async () => {
        return null;
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(401);
  });

  it("returns 404 when the document is not found", async () => {
    const port = makePort({
      loadDocument: async () => {
        return null;
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 404 (not 403) when the document belongs to a different workspace (no cross-tenant leak)", async () => {
    const port = makePort({
      loadDocument: async () => {
        return { id: DOC_ID, workspaceId: WORKSPACE_B, storagePath: STORAGE_PATH };
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 404 when membership has been revoked mid-session (defense-in-depth)", async () => {
    const port = makePort({
      isWorkspaceMember: async () => {
        return false;
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(404);
  });

  it("returns 500 when the storage adapter cannot mint a signed URL", async () => {
    const port = makePort({
      createSignedReadUrl: async () => {
        return null;
      },
    });

    const response = await handlePreviewUrl(sameOriginRequest(), DOC_ID, port);

    expect(response.status).toBe(500);
  });
});
