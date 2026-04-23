import { describe, expect, it } from "vitest";
import { type ExportPort, type ExportableSource, buildExportFilename, handleExport } from "@/lib/export/handler";

const WORKSPACE_A = "11111111-1111-4111-a111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-a222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

const DOC_W2_A = "dddddd01-dddd-4ddd-bddd-dddddddddddd";
const DOC_W2_B = "dddddd02-dddd-4ddd-bddd-dddddddddddd";
const DOC_NEC = "dddddd03-dddd-4ddd-bddd-dddddddddddd";

const w2Source = (overrides?: Partial<ExportableSource>): ExportableSource => {
  return {
    id: DOC_W2_A,
    filename: "w2-acme.pdf",
    doc_type: "w2",
    extracted_data: {
      employer_name: { value: "Acme Corp", confidence: 0.99 },
      wages: { value: 50000, confidence: 0.97 },
    },
    ...overrides,
  };
};

const necSource = (overrides?: Partial<ExportableSource>): ExportableSource => {
  return {
    id: DOC_NEC,
    filename: "1099-nec-foo.pdf",
    doc_type: "1099_nec",
    extracted_data: {
      payer_name: { value: "Payer Inc", confidence: 0.95 },
      nonemployee_compensation: { value: 12000, confidence: 0.9 },
    },
    ...overrides,
  };
};

const sameOriginRequest = (query: string = ""): Request => {
  const url = query === "" ? "https://app.example/api/export" : `https://app.example/api/export?${query}`;

  return new Request(url, {
    method: "GET",
    headers: { origin: "https://app.example" },
  });
};

const defaultSources: ExportableSource[] = [
  w2Source(),
  w2Source({ id: DOC_W2_B, filename: "w2-beta.pdf" }),
  necSource(),
];

const makePort = (overrides?: Partial<ExportPort>): ExportPort => {
  const sources = defaultSources;

  return {
    getAuthContext: async () => {
      return { userId: USER_A, workspaceId: WORKSPACE_A };
    },
    checkOrigin: () => {
      return true;
    },
    loadCompleteDocuments: async (_workspaceId, docType) => {
      if (docType === null) {
        return sources;
      }

      return sources.filter(source => {
        return source.doc_type === docType;
      });
    },
    buildZipBuffer: async files => {
      // Encode a deterministic manifest so the test can introspect which files the
      // handler passed into the zip layer without running a real zip implementation.
      const manifest = JSON.stringify(
        files.map(f => {
          return f.name;
        })
      );

      const encoder = new TextEncoder();
      const bytes = encoder.encode(manifest);
      // Copy into a fresh ArrayBuffer so the returned type is BodyInit-compatible
      // across TS lib revisions where the underlying Uint8Array may be backed by
      // SharedArrayBuffer.
      const buffer = new ArrayBuffer(bytes.byteLength);

      new Uint8Array(buffer).set(bytes);

      return buffer;
    },
    now: () => {
      return new Date("2026-04-25T13:45:00Z");
    },
    ...overrides,
  };
};

const readManifest = async (response: Response): Promise<string[]> => {
  const text = await response.text();
  const parsed: unknown = JSON.parse(text);

  if (!Array.isArray(parsed)) {
    throw new Error("manifest was not an array");
  }

  return parsed.filter((item): item is string => {
    return typeof item === "string";
  });
};

describe("handleExport", () => {
  it("returns 200 with a zip containing one CSV per present doc_type on the happy path", async () => {
    const response = await handleExport(sameOriginRequest(), makePort());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");

    const disposition = response.headers.get("content-disposition") ?? "";

    expect(disposition.startsWith("attachment; filename=")).toBe(true);
    expect(disposition.includes("otc-export-")).toBe(true);

    const manifest = await readManifest(response);

    expect(manifest).toEqual(["w2.csv", "1099_nec.csv"]);
  });

  it("restricts the zip to a single doc type when filtered by type", async () => {
    const response = await handleExport(sameOriginRequest("type=w2"), makePort());

    expect(response.status).toBe(200);

    const manifest = await readManifest(response);

    expect(manifest).toEqual(["w2.csv"]);
  });

  it("returns 200 when status=complete (explicitly requested)", async () => {
    const response = await handleExport(sameOriginRequest("status=complete"), makePort());

    expect(response.status).toBe(200);
  });

  it("returns 400 when status=needs_review (excluded by R14a)", async () => {
    const response = await handleExport(sameOriginRequest("status=needs_review"), makePort());

    expect(response.status).toBe(400);

    const body: unknown = await response.json();

    expect(body).toEqual({ error: "no_documents_match" });
  });

  it("returns 400 when status is any non-complete value (pending/processing/failed)", async () => {
    for (const status of ["pending", "processing", "failed"]) {
      const response = await handleExport(sameOriginRequest(`status=${status}`), makePort());

      expect(response.status).toBe(400);
    }
  });

  it("returns 400 when the workspace has no completed documents", async () => {
    const response = await handleExport(
      sameOriginRequest(),
      makePort({
        loadCompleteDocuments: async () => {
          return [];
        },
      })
    );

    expect(response.status).toBe(400);

    const body: unknown = await response.json();

    expect(body).toEqual({ error: "no_documents_match" });
  });

  it("returns 400 when a type filter excludes every row", async () => {
    const response = await handleExport(sameOriginRequest("type=k1"), makePort());

    expect(response.status).toBe(400);
  });

  it("narrows the rows by query (q) against filename and searched extracted_data keys", async () => {
    const response = await handleExport(sameOriginRequest("q=acme"), makePort());

    expect(response.status).toBe(200);

    const manifest = await readManifest(response);

    // Only w2-acme.pdf matches on filename. The Payer Inc 1099 is excluded.
    expect(manifest).toEqual(["w2.csv"]);
  });

  it("applies the q predicate against rows whose extracted_data contains a searched key (dashboard parity)", async () => {
    // live-feed.matchesSearch searches exactly the keys `payer`, `employer`, `tin`
    // under extracted_data — not `payer_name`/`payer_tin`. Mirror that here so a
    // doc whose extracted_data keys the handler-facing shape includes `payer`
    // participates in the search.
    const port = makePort({
      loadCompleteDocuments: async () => {
        return [
          w2Source({ filename: "anonymous.pdf" }),
          necSource({
            filename: "anonymous-nec.pdf",
            extracted_data: {
              payer: { value: "Stripe Inc", confidence: 0.95 },
            },
          }),
        ];
      },
    });

    const response = await handleExport(sameOriginRequest("q=stripe"), port);

    expect(response.status).toBe(200);

    const manifest = await readManifest(response);

    expect(manifest).toEqual(["1099_nec.csv"]);
  });

  it("returns 400 when the q filter produces zero matches", async () => {
    const response = await handleExport(sameOriginRequest("q=no-such-document"), makePort());

    expect(response.status).toBe(400);
  });

  it("honors all three filters together (type + status=complete + q)", async () => {
    // The user is filtering to "W-2 docs whose filename contains 'acme' and are
    // complete". Two W-2s in the fixture match the status+type predicates; only
    // one matches q.
    const response = await handleExport(sameOriginRequest("type=w2&status=complete&q=acme"), makePort());

    expect(response.status).toBe(200);

    const manifest = await readManifest(response);

    expect(manifest).toEqual(["w2.csv"]);
  });

  it("returns 403 when the origin check fails", async () => {
    const response = await handleExport(
      sameOriginRequest(),
      makePort({
        checkOrigin: () => {
          return false;
        },
      })
    );

    expect(response.status).toBe(403);
  });

  it("returns 401 when auth is missing", async () => {
    const response = await handleExport(
      sameOriginRequest(),
      makePort({
        getAuthContext: async () => {
          return null;
        },
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns 400 when an invalid type filter is passed", async () => {
    const response = await handleExport(sameOriginRequest("type=not-a-doc-type"), makePort());

    expect(response.status).toBe(400);

    const body: unknown = await response.json();

    expect(body).toEqual({ error: "invalid_filters" });
  });

  it("returns 400 when an invalid status filter is passed", async () => {
    const response = await handleExport(sameOriginRequest("status=exporting"), makePort());

    expect(response.status).toBe(400);
  });

  it("scopes the DB query to the authed workspace", async () => {
    let observedWorkspaceId: string | null = null;

    const port = makePort({
      loadCompleteDocuments: async workspaceId => {
        observedWorkspaceId = workspaceId;

        return defaultSources;
      },
    });

    await handleExport(sameOriginRequest(), port);

    expect(observedWorkspaceId).toBe(WORKSPACE_A);
    // Sanity-check that the handler never used an unrelated workspace.
    expect(observedWorkspaceId).not.toBe(WORKSPACE_B);
  });

  it("drops rows whose extracted_data is malformed rather than crashing", async () => {
    const port = makePort({
      loadCompleteDocuments: async () => {
        return [w2Source({ extracted_data: null })];
      },
    });

    // Malformed extracted_data projects to {} but the row still belongs to w2 — the
    // export should still succeed with an all-empty-cells row rather than 500ing.
    const response = await handleExport(sameOriginRequest(), port);

    expect(response.status).toBe(200);

    const manifest = await readManifest(response);

    expect(manifest).toEqual(["w2.csv"]);
  });
});

describe("buildExportFilename", () => {
  it("produces a filename with YYYYMMDD-HHmm local-time stamp and zip suffix", () => {
    // Use a specific local-time date so the assertion doesn't depend on the test
    // machine's timezone: Date constructor with Y/M/D/H/M returns local time.
    const when = new Date(2026, 3, 25, 13, 45);

    expect(buildExportFilename(when)).toBe("otc-export-20260425-1345.zip");
  });

  it("zero-pads single-digit months, days, hours, and minutes", () => {
    const when = new Date(2026, 0, 5, 2, 7);

    expect(buildExportFilename(when)).toBe("otc-export-20260105-0207.zip");
  });
});
