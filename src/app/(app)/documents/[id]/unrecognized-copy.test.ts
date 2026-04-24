import { describe, expect, it } from "vitest";
import { DOC_TYPE_SPECS, SUPPORTED_DOC_TYPES } from "@/app/(app)/documents/[id]/form-schemas";
import { formatSupportedTypesList } from "@/app/(app)/documents/[id]/unrecognized-copy";

describe("formatSupportedTypesList", () => {
  it("returns the current four-type roster as 'W-2, 1099-NEC, 1099-MISC, or K-1'", () => {
    expect(formatSupportedTypesList()).toBe("W-2, 1099-NEC, 1099-MISC, or K-1");
  });

  it("contains every current DOC_TYPE_SPECS label so renames flow through without updating this test", () => {
    const rendered = formatSupportedTypesList();

    for (const docType of SUPPORTED_DOC_TYPES) {
      expect(rendered).toContain(DOC_TYPE_SPECS[docType].label);
    }
  });
});
