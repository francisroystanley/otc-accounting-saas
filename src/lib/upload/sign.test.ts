import { describe, expect, it, vi } from "vitest";
import { type UploadSignPort, handleUploadSign } from "@/lib/upload/sign";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

const makePort = (overrides?: Partial<UploadSignPort>): UploadSignPort => {
  return {
    getAuthContext: async () => {
      return { userId: USER_ID, workspaceId: WORKSPACE_ID };
    },
    checkOrigin: () => {
      return true;
    },
    createSignedUploadUrl: async () => {
      return {
        signedUrl: "https://storage.example/signed/url?token=abc",
        token: "abc",
      };
    },
    generateDocumentId: () => {
      return DOCUMENT_ID;
    },
    ...overrides,
  };
};

const buildRequest = (body: unknown): Request => {
  return new Request("http://localhost/api/upload/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("handleUploadSign — happy path", () => {
  it("returns a signed upload URL and storage path scoped to the caller's workspace", async () => {
    const port = makePort();
    const response = await handleUploadSign(buildRequest({ filename: "w2-2026.pdf" }), port);

    expect(response.status).toBe(200);

    const payload: unknown = await response.json();

    expect(payload).toEqual({
      ok: true,
      signedUrl: "https://storage.example/signed/url?token=abc",
      token: "abc",
      documentId: DOCUMENT_ID,
      storagePath: `${WORKSPACE_ID}/${DOCUMENT_ID}.pdf`,
    });
  });

  it("passes the server-generated storagePath through to createSignedUploadUrl", async () => {
    const mintSpy = vi.fn(async () => {
      return { signedUrl: "u", token: "t" };
    });

    const port = makePort({ createSignedUploadUrl: mintSpy });

    await handleUploadSign(buildRequest({ filename: "a.pdf" }), port);

    expect(mintSpy).toHaveBeenCalledTimes(1);
    expect(mintSpy).toHaveBeenCalledWith(`${WORKSPACE_ID}/${DOCUMENT_ID}.pdf`);
  });
});

describe("handleUploadSign — auth and origin", () => {
  it("returns 403 when origin check fails", async () => {
    const port = makePort({
      checkOrigin: () => {
        return false;
      },
    });

    const response = await handleUploadSign(buildRequest({ filename: "a.pdf" }), port);

    expect(response.status).toBe(403);
  });

  it("returns 401 when there is no authenticated context", async () => {
    const port = makePort({
      getAuthContext: async () => {
        return null;
      },
    });

    const response = await handleUploadSign(buildRequest({ filename: "a.pdf" }), port);

    expect(response.status).toBe(401);
  });
});

describe("handleUploadSign — filename validation", () => {
  it("rejects filenames with path separators", async () => {
    const mintSpy = vi.fn();
    const port = makePort({ createSignedUploadUrl: mintSpy });
    const response = await handleUploadSign(buildRequest({ filename: "../evil.pdf" }), port);

    expect(response.status).toBe(400);
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("rejects non-.pdf extensions", async () => {
    const port = makePort();
    const response = await handleUploadSign(buildRequest({ filename: "w2.txt" }), port);

    expect(response.status).toBe(400);
  });

  it("rejects missing filename field", async () => {
    const port = makePort();
    const response = await handleUploadSign(buildRequest({}), port);

    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const port = makePort();
    const request = new Request("http://localhost/api/upload/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const response = await handleUploadSign(request, port);

    expect(response.status).toBe(400);
  });
});

describe("handleUploadSign — upstream failure", () => {
  it("returns 500 when the storage client cannot mint a signed URL", async () => {
    const port = makePort({
      createSignedUploadUrl: async () => {
        return null;
      },
    });

    const response = await handleUploadSign(buildRequest({ filename: "a.pdf" }), port);

    expect(response.status).toBe(500);

    const payload: unknown = await response.json();

    expect(payload).toEqual({ ok: false, code: "signed_url_failed" });
  });
});
