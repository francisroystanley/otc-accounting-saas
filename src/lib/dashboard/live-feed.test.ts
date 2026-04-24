import { describe, expect, it } from "vitest";
import {
  type DocumentRow,
  type FeedEvent,
  applyEvent,
  countLowConfidence,
  filterByParams,
  isUnrecognized,
  matchesSearch,
  mergeEvents,
  parseDashboardSearchParams,
} from "@/lib/dashboard/live-feed";

const WORKSPACE_A = "11111111-1111-4111-a111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-a222-222222222222";

type RowOverrides = Partial<DocumentRow>;

const makeRow = (id: string, overrides: RowOverrides = {}): DocumentRow => {
  return {
    id,
    workspace_id: WORKSPACE_A,
    filename: `${id}.pdf`,
    doc_type: null,
    doc_type_confidence: null,
    status: "pending",
    storage_path: `workspaces/${WORKSPACE_A}/${id}.pdf`,
    uploaded_by: null,
    extracted_data: null,
    edited_fields: null,
    error_message: null,
    created_at: "2026-04-22T10:00:00.000Z",
    updated_at: "2026-04-22T10:00:00.000Z",
    ...overrides,
  };
};

describe("mergeEvents", () => {
  it("folds an insert followed by an update by id, keeping the newer updated_at", () => {
    const a = makeRow("a", { updated_at: "2026-04-22T10:00:00.000Z", status: "pending" });
    const aUpdated = makeRow("a", { updated_at: "2026-04-22T10:05:00.000Z", status: "processing" });
    const b = makeRow("b", { updated_at: "2026-04-22T10:02:00.000Z" });
    const events: FeedEvent[] = [
      { kind: "insert", row: b },
      { kind: "update", row: aUpdated },
    ];

    const result = mergeEvents([a], events, WORKSPACE_A);

    expect(result).toHaveLength(2);
    expect(
      result.find(r => {
        return r.id === "a";
      })?.status
    ).toBe("processing");
    expect(
      result.find(r => {
        return r.id === "b";
      })
    ).toBeDefined();
  });

  it("removes a row on delete", () => {
    const a = makeRow("a");
    const events: FeedEvent[] = [{ kind: "delete", id: "a", workspaceId: WORKSPACE_A }];

    const result = mergeEvents([a], events, WORKSPACE_A);

    expect(result).toEqual([]);
  });

  it("drops events from a different workspace even if the reducer is handed one", () => {
    const leak = makeRow("leak", { workspace_id: WORKSPACE_B });
    const events: FeedEvent[] = [
      { kind: "insert", row: leak },
      { kind: "delete", id: "other", workspaceId: WORKSPACE_B },
    ];

    const result = mergeEvents([], events, WORKSPACE_A);

    expect(result).toEqual([]);
  });

  it("is idempotent on replayed insert events", () => {
    const a = makeRow("a");
    const events: FeedEvent[] = [
      { kind: "insert", row: a },
      { kind: "insert", row: a },
    ];

    const result = mergeEvents([a], events, WORKSPACE_A);

    expect(result).toHaveLength(1);
  });

  it("keeps the newer row when two updates arrive out of order", () => {
    const a = makeRow("a", { updated_at: "2026-04-22T10:00:00.000Z", status: "pending" });
    const aLater = makeRow("a", { updated_at: "2026-04-22T10:10:00.000Z", status: "complete" });
    const aEarlier = makeRow("a", { updated_at: "2026-04-22T10:05:00.000Z", status: "processing" });

    const events: FeedEvent[] = [
      { kind: "update", row: aLater },
      { kind: "update", row: aEarlier },
    ];

    const result = mergeEvents([a], events, WORKSPACE_A);

    expect(result[0]?.status).toBe("complete");
    expect(result[0]?.updated_at).toBe("2026-04-22T10:10:00.000Z");
  });
});

describe("applyEvent", () => {
  it("is a no-op for a delete on an unknown id", () => {
    const a = makeRow("a");
    const rows = [a];

    const result = applyEvent(rows, { kind: "delete", id: "unknown", workspaceId: WORKSPACE_A }, WORKSPACE_A);

    expect(result).toEqual(rows);
  });

  it("prepends inserts so newer rows appear first by default", () => {
    const a = makeRow("a", { created_at: "2026-04-22T10:00:00.000Z" });
    const b = makeRow("b", { created_at: "2026-04-22T10:05:00.000Z" });

    const result = applyEvent([a], { kind: "insert", row: b }, WORKSPACE_A);

    expect(
      result.map(r => {
        return r.id;
      })
    ).toEqual(["b", "a"]);
  });

  it("drops a cross-workspace insert event", () => {
    const leak = makeRow("leak", { workspace_id: WORKSPACE_B });

    const result = applyEvent([], { kind: "insert", row: leak }, WORKSPACE_A);

    expect(result).toEqual([]);
  });

  it("drops a cross-workspace delete event", () => {
    const a = makeRow("a");

    const result = applyEvent([a], { kind: "delete", id: "a", workspaceId: WORKSPACE_B }, WORKSPACE_A);

    expect(result).toEqual([a]);
  });
});

describe("countLowConfidence", () => {
  const THRESHOLD = 0.85;

  it("returns 0 for non-complete rows regardless of extracted_data", () => {
    const row = makeRow("a", {
      status: "processing",
      extracted_data: { wages: { value: "1000", confidence: 0.1 } },
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(0);
  });

  it("counts fields with confidence below the threshold", () => {
    const row = makeRow("a", {
      status: "complete",
      extracted_data: {
        wages: { value: "1000", confidence: 0.9 },
        federal_tax: { value: "100", confidence: 0.5 },
        payer: { value: "Acme", confidence: 0.7 },
      },
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(2);
  });

  it("excludes fields that have been edited (one-way latch)", () => {
    const row = makeRow("a", {
      status: "complete",
      extracted_data: {
        wages: { value: "1000", confidence: 0.1 },
        federal_tax: { value: "100", confidence: 0.2 },
      },
      edited_fields: { wages: true },
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(1);
  });

  it("returns 0 when extracted_data is null", () => {
    const row = makeRow("a", { status: "complete", extracted_data: null });

    expect(countLowConfidence(row, THRESHOLD)).toBe(0);
  });

  it("treats edited_fields=null as no edits", () => {
    const row = makeRow("a", {
      status: "complete",
      extracted_data: {
        wages: { value: "1000", confidence: 0.2 },
      },
      edited_fields: null,
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(1);
  });

  it("ignores fields without a numeric confidence", () => {
    const row = makeRow("a", {
      status: "complete",
      extracted_data: {
        wages: { value: "1000" },
        payer: "Acme",
      },
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(0);
  });

  it("does not count fields at the threshold boundary", () => {
    const row = makeRow("a", {
      status: "complete",
      extracted_data: {
        wages: { value: "1000", confidence: 0.85 },
        tips: { value: "50", confidence: 0.849 },
      },
    });

    expect(countLowConfidence(row, THRESHOLD)).toBe(1);
  });
});

describe("isUnrecognized", () => {
  const unknownExtracted = { doc_type: "unknown", doc_type_confidence: 0.4, fields: null };

  it("returns true for needs_review + doc_type='unknown' + fields:null", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "unknown",
      extracted_data: unknownExtracted,
    });

    expect(isUnrecognized(row)).toBe(true);
  });

  it("returns true when doc_type is null (same Unrecognized story)", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: null,
      extracted_data: unknownExtracted,
    });

    expect(isUnrecognized(row)).toBe(true);
  });

  it("returns true for arbitrary unsupported doc_type strings (e.g. future form types)", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "1099_k",
      extracted_data: unknownExtracted,
    });

    expect(isUnrecognized(row)).toBe(true);
  });

  it("returns false for low-confidence W-2 on needs_review (the existing Needs review path)", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "w2",
      doc_type_confidence: 0.6,
      extracted_data: {
        doc_type: "w2",
        doc_type_confidence: 0.6,
        fields: { wages: { value: 50000, confidence: 0.5 } },
      },
    });

    expect(isUnrecognized(row)).toBe(false);
  });

  it("returns false when extracted_data is null (guard against schema drift)", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "unknown",
      extracted_data: null,
    });

    expect(isUnrecognized(row)).toBe(false);
  });

  it("returns false when fields is an empty object, not null", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "unknown",
      extracted_data: { doc_type: "unknown", fields: {} },
    });

    expect(isUnrecognized(row)).toBe(false);
  });

  it("returns false when extracted_data is a record but the fields key is absent entirely", () => {
    const row = makeRow("a", {
      status: "needs_review",
      doc_type: "unknown",
      extracted_data: { doc_type: "unknown" },
    });

    expect(isUnrecognized(row)).toBe(false);
  });

  it("returns false for non-needs_review statuses regardless of shape", () => {
    const statuses: ReadonlyArray<DocumentRow["status"]> = ["pending", "processing", "complete", "failed"];

    for (const status of statuses) {
      const row = makeRow(status, {
        status,
        doc_type: "unknown",
        extracted_data: unknownExtracted,
      });

      expect(isUnrecognized(row)).toBe(false);
    }
  });
});

describe("matchesSearch", () => {
  it("returns true for an empty or whitespace-only query", () => {
    const row = makeRow("a", { filename: "w2.pdf" });

    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  it("matches a case-insensitive substring of the filename", () => {
    const row = makeRow("a", { filename: "Acme-W2-2024.pdf" });

    expect(matchesSearch(row, "acme")).toBe(true);
    expect(matchesSearch(row, "W2")).toBe(true);
    expect(matchesSearch(row, "2024")).toBe(true);
    expect(matchesSearch(row, "nope")).toBe(false);
  });

  it("matches a string value under payer/employer/tin in extracted_data", () => {
    const row = makeRow("a", {
      extracted_data: {
        payer: { value: "Globex Corp", confidence: 0.9 },
        employer: "Initech",
        tin: { value: "12-3456789", confidence: 0.95 },
      },
    });

    expect(matchesSearch(row, "globex")).toBe(true);
    expect(matchesSearch(row, "initech")).toBe(true);
    expect(matchesSearch(row, "3456789")).toBe(true);
    expect(matchesSearch(row, "nomatch")).toBe(false);
  });

  it("skips non-string values under searched keys without throwing", () => {
    const row = makeRow("a", {
      extracted_data: {
        payer: 12345,
        employer: { value: 99, confidence: 0.2 },
      },
    });

    expect(() => {
      return matchesSearch(row, "99");
    }).not.toThrow();
    expect(matchesSearch(row, "99")).toBe(false);
  });
});

describe("filterByParams", () => {
  const rows = [
    makeRow("w2a", { doc_type: "w2", status: "complete" }),
    makeRow("1099a", { doc_type: "1099_nec", status: "needs_review" }),
    makeRow("pendingA", { doc_type: null, status: "pending" }),
  ];

  it("returns all rows when both filters are absent or 'all'", () => {
    expect(filterByParams(rows, { type: null, status: null })).toEqual(rows);
    expect(filterByParams(rows, { type: "all", status: "all" })).toEqual(rows);
  });

  it("filters by doc_type", () => {
    const result = filterByParams(rows, { type: "w2", status: null });

    expect(
      result.map(r => {
        return r.id;
      })
    ).toEqual(["w2a"]);
  });

  it("filters by status", () => {
    const result = filterByParams(rows, { type: null, status: "needs_review" });

    expect(
      result.map(r => {
        return r.id;
      })
    ).toEqual(["1099a"]);
  });

  it("combines doc_type and status filters with AND semantics", () => {
    const result = filterByParams(rows, { type: "w2", status: "needs_review" });

    expect(result).toEqual([]);
  });
});

describe("parseDashboardSearchParams", () => {
  it("returns nulls when no params present", () => {
    expect(parseDashboardSearchParams({})).toEqual({ type: null, status: null, q: null });
  });

  it("parses known doc_type and status values", () => {
    const parsed = parseDashboardSearchParams({ type: "w2", status: "needs_review", q: "acme" });

    expect(parsed).toEqual({ type: "w2", status: "needs_review", q: "acme" });
  });

  it("drops unknown status values to null instead of throwing", () => {
    const parsed = parseDashboardSearchParams({ status: "bogus" });

    expect(parsed.status).toBeNull();
  });

  it("drops unknown doc_type values to null", () => {
    const parsed = parseDashboardSearchParams({ type: "bogus" });

    expect(parsed.type).toBeNull();
  });

  it("flattens array-valued search params to the first entry", () => {
    const parsed = parseDashboardSearchParams({ q: ["one", "two"] });

    expect(parsed.q).toBe("one");
  });

  it("treats 'all' as a pass-through sentinel (null)", () => {
    const parsed = parseDashboardSearchParams({ type: "all", status: "all" });

    expect(parsed).toEqual({ type: null, status: null, q: null });
  });
});
