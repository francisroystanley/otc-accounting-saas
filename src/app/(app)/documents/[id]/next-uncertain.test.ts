import { describe, expect, it } from "vitest";
import {
  type UncertainInput,
  hasAnyUncertain,
  isFieldUncertain,
  nextUncertainField,
} from "@/app/(app)/documents/[id]/next-uncertain";

const THRESHOLD = 0.85;

const makeInput = (overrides?: Partial<UncertainInput>): UncertainInput => {
  return {
    fields: ["a", "b", "c", "d"],
    confidenceMap: { a: 0.5, b: 0.9, c: 0.4, d: 0.2 },
    editedFields: {},
    threshold: THRESHOLD,
    ...overrides,
  };
};

describe("isFieldUncertain", () => {
  it("is true when confidence is below threshold and field is not edited", () => {
    expect(isFieldUncertain("a", { a: 0.4 }, {}, THRESHOLD)).toBe(true);
  });

  it("is false when confidence is at the threshold boundary (not below)", () => {
    expect(isFieldUncertain("a", { a: 0.85 }, {}, THRESHOLD)).toBe(false);
  });

  it("is false when the field has been edited (one-way latch)", () => {
    expect(isFieldUncertain("a", { a: 0.1 }, { a: true }, THRESHOLD)).toBe(false);
  });

  it("is false when confidence is null (no badge applies)", () => {
    expect(isFieldUncertain("a", { a: null }, {}, THRESHOLD)).toBe(false);
  });

  it("is false when confidence is missing from the map", () => {
    expect(isFieldUncertain("a", {}, {}, THRESHOLD)).toBe(false);
  });
});

describe("hasAnyUncertain", () => {
  it("is true when at least one field is uncertain", () => {
    expect(hasAnyUncertain(makeInput())).toBe(true);
  });

  it("is false when all uncertain fields have been edited", () => {
    const input = makeInput({ editedFields: { a: true, c: true, d: true } });

    expect(hasAnyUncertain(input)).toBe(false);
  });

  it("is false when all confidence values are at or above the threshold", () => {
    const input = makeInput({ confidenceMap: { a: 0.9, b: 0.95, c: 0.88, d: 0.85 } });

    expect(hasAnyUncertain(input)).toBe(false);
  });

  it("is false on an empty field list", () => {
    expect(hasAnyUncertain(makeInput({ fields: [] }))).toBe(false);
  });
});

describe("nextUncertainField", () => {
  it("returns the first uncertain field when no field is currently focused", () => {
    expect(nextUncertainField(makeInput(), null)).toBe("a");
  });

  it("advances to the next uncertain field after the currently focused one", () => {
    expect(nextUncertainField(makeInput(), "a")).toBe("c");
  });

  it("skips fields with high confidence on the way", () => {
    const input = makeInput({ fields: ["a", "b", "c"], confidenceMap: { a: 0.9, b: 0.95, c: 0.2 } });

    expect(nextUncertainField(input, null)).toBe("c");
  });

  it("skips edited fields (one-way latch)", () => {
    const input = makeInput({ editedFields: { a: true } });

    expect(nextUncertainField(input, null)).toBe("c");
  });

  it("wraps from the last uncertain field to the first uncertain field", () => {
    expect(nextUncertainField(makeInput(), "d")).toBe("a");
  });

  it("wraps across a high-confidence field at the end", () => {
    const input = makeInput({ confidenceMap: { a: 0.4, b: 0.9, c: 0.4, d: 0.99 } });

    expect(nextUncertainField(input, "c")).toBe("a");
  });

  it("returns null when there are no uncertain fields", () => {
    const input = makeInput({ confidenceMap: { a: 0.9, b: 0.95, c: 0.9, d: 0.9 } });

    expect(nextUncertainField(input, null)).toBeNull();
  });

  it("returns null when the only uncertain fields are all edited", () => {
    const input = makeInput({ editedFields: { a: true, c: true, d: true } });

    expect(nextUncertainField(input, null)).toBeNull();
  });

  it("returns the next uncertain even when the current field is not in the list", () => {
    expect(nextUncertainField(makeInput(), "nonexistent")).toBe("a");
  });

  it("cycles through all uncertain fields on repeated calls", () => {
    const input = makeInput();
    const visited: string[] = [];
    let current: string | null = null;

    for (let i = 0; i < 4; i += 1) {
      const next = nextUncertainField(input, current);

      if (next === null) {
        break;
      }

      visited.push(next);
      current = next;
    }

    expect(visited).toEqual(["a", "c", "d", "a"]);
  });
});
