import { describe, expect, it } from "vitest";
import { type DocType } from "@/lib/documents/doc-types";
import {
  type ExportableRow,
  buildCsvFiles,
  buildCsvForDocType,
  escapeCsvField,
  groupByDocType,
  headerRowFor,
  sanitizeStringCell,
} from "@/lib/export/csv";

const w2Row = (overrides?: Partial<ExportableRow>): ExportableRow => {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    filename: "w2-acme.pdf",
    doc_type: "w2",
    extracted_data: {
      employee_ssn: { value: "123-45-6789", confidence: 0.97 },
      employer_ein: { value: "12-3456789", confidence: 0.95 },
      employer_name: { value: "Acme Corp", confidence: 0.99 },
      employee_name: { value: "Jane Doe", confidence: 0.98 },
      wages: { value: 54321.0, confidence: 0.96 },
      federal_income_tax_withheld: { value: 5432.1, confidence: 0.94 },
      social_security_wages: { value: 54321.0, confidence: 0.95 },
      social_security_tax_withheld: { value: 3367.9, confidence: 0.93 },
      medicare_wages: { value: 54321.0, confidence: 0.95 },
      medicare_tax_withheld: { value: 787.65, confidence: 0.92 },
    },
    ...overrides,
  };
};

const nec1099Row = (overrides?: Partial<ExportableRow>): ExportableRow => {
  return {
    id: "22222222-2222-4222-a222-222222222222",
    filename: "1099-nec-foo.pdf",
    doc_type: "1099_nec",
    extracted_data: {
      payer_name: { value: "Payer Inc", confidence: 0.9 },
      payer_tin: { value: "98-7654321", confidence: 0.91 },
      recipient_name: { value: "John Smith", confidence: 0.92 },
      recipient_tin: { value: "000-00-0000", confidence: 0.93 },
      nonemployee_compensation: { value: 12000, confidence: 0.94 },
      federal_income_tax_withheld: { value: 0, confidence: 0.95 },
    },
    ...overrides,
  };
};

describe("sanitizeStringCell", () => {
  it("returns the value unchanged when it does not start with a formula prefix", () => {
    expect(sanitizeStringCell("Acme Corp")).toBe("Acme Corp");
    expect(sanitizeStringCell("123-45-6789")).toBe("123-45-6789");
    expect(sanitizeStringCell("")).toBe("");
  });

  it("prefixes values starting with '=' (formula injection vector)", () => {
    expect(sanitizeStringCell("=HYPERLINK('evil')")).toBe("'=HYPERLINK('evil')");
  });

  it("prefixes values starting with '+', '-', '@', tab, or carriage return", () => {
    expect(sanitizeStringCell("+cmd|calc")).toBe("'+cmd|calc");
    expect(sanitizeStringCell("-SUM(A:A)")).toBe("'-SUM(A:A)");
    expect(sanitizeStringCell("@AppleScript")).toBe("'@AppleScript");
    expect(sanitizeStringCell("\t=WEBSERVICE()")).toBe("'\t=WEBSERVICE()");
    expect(sanitizeStringCell("\rformula")).toBe("'\rformula");
  });

  it("propagates sanitization through buildCsvForDocType for filenames and string fields", () => {
    const row: ExportableRow = {
      id: "11111111-1111-4111-a111-111111111111",
      filename: "=HYPERLINK('evil')",
      doc_type: "w2",
      extracted_data: {
        employer_name: { value: "=CMD('calc')", confidence: 0.99 },
      },
    };

    const csv = buildCsvForDocType("w2", [row]);

    // The CSV must contain the prefixed (neutralized) forms, not the raw formula strings.
    expect(csv.includes("'=HYPERLINK('evil')")).toBe(true);
    expect(csv.includes("'=CMD('calc')")).toBe(true);
    // And a naive "HYPERLINK(" cell without the leading apostrophe must not appear.
    expect(csv.includes(",=HYPERLINK(")).toBe(false);
    expect(csv.includes(",=CMD(")).toBe(false);
  });

  it("does not change numeric values — negative numbers are still parsed as numbers by spreadsheets", () => {
    const row: ExportableRow = {
      id: "11111111-1111-4111-a111-111111111111",
      filename: "safe.pdf",
      doc_type: "w2",
      extracted_data: {
        federal_income_tax_withheld: { value: -1234.56, confidence: 0.9 },
      },
    };

    const csv = buildCsvForDocType("w2", [row]);

    // Negative number serializes as plain "-1234.56", no leading apostrophe.
    expect(csv.includes(",-1234.56,")).toBe(true);
  });
});

describe("escapeCsvField", () => {
  it("returns the value unchanged when no special characters are present", () => {
    expect(escapeCsvField("simple")).toBe("simple");
    expect(escapeCsvField("12345.67")).toBe("12345.67");
  });

  it("wraps values containing commas in double quotes", () => {
    expect(escapeCsvField("Doe, Jane")).toBe('"Doe, Jane"');
  });

  it("doubles internal double quotes and wraps the value", () => {
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("wraps values containing newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps values containing carriage returns", () => {
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("handles an empty string without wrapping", () => {
    expect(escapeCsvField("")).toBe("");
  });
});

describe("headerRowFor", () => {
  it("returns document_id, filename, and value/confidence siblings for W-2", () => {
    expect(headerRowFor("w2")).toEqual([
      "document_id",
      "filename",
      "employee_ssn",
      "employee_ssn_confidence",
      "employer_ein",
      "employer_ein_confidence",
      "employer_name",
      "employer_name_confidence",
      "employee_name",
      "employee_name_confidence",
      "wages",
      "wages_confidence",
      "federal_income_tax_withheld",
      "federal_income_tax_withheld_confidence",
      "social_security_wages",
      "social_security_wages_confidence",
      "social_security_tax_withheld",
      "social_security_tax_withheld_confidence",
      "medicare_wages",
      "medicare_wages_confidence",
      "medicare_tax_withheld",
      "medicare_tax_withheld_confidence",
    ]);
  });

  it("produces a header for every supported doc type", () => {
    const docTypes: DocType[] = ["w2", "1099_nec", "1099_misc", "k1"];

    for (const docType of docTypes) {
      const header = headerRowFor(docType);

      expect(header[0]).toBe("document_id");
      expect(header[1]).toBe("filename");
      expect(header.length % 2).toBe(0);
    }
  });
});

describe("buildCsvForDocType", () => {
  it("emits header and row with CRLF line terminators", () => {
    const csv = buildCsvForDocType("1099_nec", [nec1099Row()]);
    const lines = csv.split("\r\n");

    expect(lines[0].startsWith("document_id,filename,payer_name,payer_name_confidence")).toBe(true);
    expect(lines[1].startsWith("22222222-2222-4222-a222-222222222222,1099-nec-foo.pdf,Payer Inc,0.9")).toBe(true);
    expect(lines[lines.length - 1]).toBe("");
  });

  it("emits empty cells when extracted_data is missing a field", () => {
    const row = w2Row({
      extracted_data: {
        employer_name: { value: "Acme Corp", confidence: 0.99 },
      },
    });

    const csv = buildCsvForDocType("w2", [row]);
    const dataLine = csv.split("\r\n")[1];
    const cells = dataLine.split(",");

    // document_id, filename, then 20 cells (10 fields × 2). Fields not present in
    // extracted_data must be serialized as empty cells, not "undefined" or dropped.
    expect(cells.length).toBe(22);
    expect(cells[0]).toBe(row.id);
    expect(cells[1]).toBe(row.filename);
    // employee_ssn and employee_ssn_confidence are the first two after filename —
    // missing in this row, so both should be empty.
    expect(cells[2]).toBe("");
    expect(cells[3]).toBe("");
  });

  it("quotes values containing commas (RFC 4180 end-to-end)", () => {
    const row = w2Row({
      extracted_data: {
        ...w2Row().extracted_data,
        employee_name: { value: "Doe, Jane", confidence: 0.98 },
      },
    });

    const csv = buildCsvForDocType("w2", [row]);

    expect(csv.includes('"Doe, Jane"')).toBe(true);
  });

  it("quotes filenames containing double quotes", () => {
    const row = w2Row({ filename: 'weird"name.pdf' });

    const csv = buildCsvForDocType("w2", [row]);

    expect(csv.includes('"weird""name.pdf"')).toBe(true);
  });

  it("serializes numeric values as their plain decimal representation", () => {
    const csv = buildCsvForDocType("w2", [w2Row()]);
    const dataLine = csv.split("\r\n")[1];

    expect(dataLine.includes(",54321,")).toBe(true);
    expect(dataLine.includes(",0.96,")).toBe(true);
  });

  it("emits header only when there are no rows", () => {
    const csv = buildCsvForDocType("w2", []);

    expect(csv.split("\r\n").length).toBe(2);
    expect(csv.split("\r\n")[1]).toBe("");
  });

  it("drops non-finite numeric values as empty cells instead of 'NaN' text", () => {
    const row = w2Row({
      extracted_data: {
        ...w2Row().extracted_data,
        wages: { value: Number.NaN, confidence: 0.96 },
      },
    });

    const csv = buildCsvForDocType("w2", [row]);
    const dataLine = csv.split("\r\n")[1];

    expect(dataLine.includes(",NaN,")).toBe(false);
  });
});

describe("groupByDocType", () => {
  it("groups rows by doc_type", () => {
    const rows: ExportableRow[] = [w2Row(), nec1099Row(), w2Row({ id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" })];
    const grouped = groupByDocType(rows);

    expect(grouped.w2?.length).toBe(2);
    expect(grouped["1099_nec"]?.length).toBe(1);
    expect(grouped["1099_misc"]).toBeUndefined();
    expect(grouped.k1).toBeUndefined();
  });

  it("returns an empty object when there are no rows", () => {
    expect(groupByDocType([])).toEqual({});
  });
});

describe("buildCsvFiles", () => {
  it("emits one file per present doc_type in declared order (w2, 1099_nec, 1099_misc, k1)", () => {
    const files = buildCsvFiles({
      "1099_nec": [nec1099Row()],
      "w2": [w2Row()],
    });

    expect(
      files.map(f => {
        return f.name;
      })
    ).toEqual(["w2.csv", "1099_nec.csv"]);
  });

  it("omits doc types with zero rows", () => {
    const files = buildCsvFiles({
      w2: [w2Row()],
      k1: [],
    });

    expect(
      files.map(f => {
        return f.name;
      })
    ).toEqual(["w2.csv"]);
  });

  it("returns an empty array for no groups", () => {
    expect(buildCsvFiles({})).toEqual([]);
  });
});
