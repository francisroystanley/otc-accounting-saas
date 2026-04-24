// One-off generator: fills the blank IRS form PDFs in fixtures/<type>/sample1.pdf
// with synthetic (fabricated) values, writes fixtures/<type>/sample2.pdf, and
// writes a matching ground-truth JSON with the values that were written.
//
// No real PII. All names/SSNs/EINs are fabricated and would not match any real
// taxpayer. The base PDFs remain public IRS templates; this script only fills
// their AcroForm text fields.
//
// Run: node scripts/generate-filled-fixtures.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..");
const FIX = path.join(REPO, "fixtures");

const W2 = {
  employee_ssn: "321-54-9876",
  employer_ein: "87-6543210",
  employer_name: "Northwind Traders Inc",
  employer_addr: "500 Commerce Way",
  employer_citystatezip: "Portland OR 97201",
  employee_firstname: "Riley",
  employee_lastname: "Nakamura",
  employee_addr: "142 Maple St",
  employee_citystatezip: "Salem OR 97301",
  wages: 72500.5,
  federal_income_tax_withheld: 8125.4,
  social_security_wages: 72500.5,
  social_security_tax_withheld: 4495.03,
  medicare_wages: 72500.5,
  medicare_tax_withheld: 1051.26,
};

const NEC = {
  payer_name: "Summit Consulting LLC",
  payer_addr: "77 Industrial Blvd, Denver CO 80202",
  payer_tin: "45-6789012",
  recipient_tin: "456-78-9012",
  recipient_name: "Avery Okonkwo",
  recipient_street: "88 Juniper Ln",
  recipient_citystatezip: "Boulder CO 80301",
  account: "ACCT-2041",
  nonemployee_compensation: 18400.0,
  federal_income_tax_withheld: 920.0,
};

const MISC = {
  payer_name: "Harborview Realty Co",
  payer_addr: "210 Pier Ave, Seattle WA 98101",
  payer_tin: "91-2345678",
  recipient_tin: "789-01-2345",
  recipient_name: "Morgan Delacroix",
  recipient_street: "15 Spruce Ct",
  recipient_citystatezip: "Tacoma WA 98402",
  account: "RENT-9901",
  rents: 24000.0,
  royalties: 1500.0,
  other_income: 350.0,
  federal_income_tax_withheld: 0.0,
};

const K1 = {
  partnership_ein: "34-5678901",
  partnership_name: "Cascade Bay Partners LP",
  partnership_addr: "400 Pier Plaza, San Diego CA 92101",
  ircenter_name: "Ogden UT",
  partner_tin: "234-56-7890",
  partner_name: "Jordan Castellanos",
  partner_addr: "92 Mariner Way, La Jolla CA 92037",
  ordinary_business_income: 42500,
  net_rental_real_estate_income: 3200,
  interest_income: 875,
  dividends: 1240,
};

const money = n => {
  if (typeof n !== "number") {
    return String(n);
  }

  return n.toFixed(2);
};

const setText = (form, name, value) => {
  try {
    const f = form.getTextField(name);
    f.setText(String(value));
  } catch (err) {
    console.warn(`  ! could not set ${name}: ${err.message}`);
  }
};

// W-2 — 6 copies present (f1_* ... f6_*). We fill Copy A only; remaining copies stay blank.
// The Gemini extractor reads the whole PDF, and filling one copy is enough for accuracy signal
// while keeping the script simple.
const fillW2 = async () => {
  const bytes = await fs.readFile(path.join(FIX, "w2", "sample1.pdf"));
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  // Copy A (f1_*)
  setText(form, "topmostSubform[0].CopyA[0].BoxA_ReadOrder[0].f1_01[0]", W2.employee_ssn);
  setText(form, "topmostSubform[0].CopyA[0].Col_Left[0].f1_02[0]", W2.employer_ein);
  setText(
    form,
    "topmostSubform[0].CopyA[0].Col_Left[0].f1_03[0]",
    `${W2.employer_name}\n${W2.employer_addr}\n${W2.employer_citystatezip}`
  );
  setText(form, "topmostSubform[0].CopyA[0].Col_Left[0].FirstName_ReadOrder[0].f1_05[0]", W2.employee_firstname);
  setText(form, "topmostSubform[0].CopyA[0].Col_Left[0].LastName_ReadOrder[0].f1_06[0]", W2.employee_lastname);
  setText(form, "topmostSubform[0].CopyA[0].Col_Left[0].f1_07[0]", W2.employee_addr);
  setText(form, "topmostSubform[0].CopyA[0].Col_Left[0].f1_08[0]", W2.employee_citystatezip);
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].Box1_ReadOrder[0].f1_09[0]", money(W2.wages));
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].f1_10[0]", money(W2.federal_income_tax_withheld));
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].Box3_ReadOrder[0].f1_11[0]", money(W2.social_security_wages));
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].f1_12[0]", money(W2.social_security_tax_withheld));
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].Box5_ReadOrder[0].f1_13[0]", money(W2.medicare_wages));
  setText(form, "topmostSubform[0].CopyA[0].Col_Right[0].f1_14[0]", money(W2.medicare_tax_withheld));

  form.flatten();
  const out = await pdf.save();
  await fs.writeFile(path.join(FIX, "w2", "sample2.pdf"), out);

  const truth = {
    _note:
      "Synthetic-filled IRS W-2 template (base PDF from irs.gov/pub/irs-pdf/fw2.pdf, Copy A filled). Values are fabricated — no PII. Employer/employee names, SSN, EIN, and all monetary amounts were written by scripts/generate-filled-fixtures.mjs.",
    doc_type: "w2",
    fields: {
      employee_ssn: W2.employee_ssn,
      employer_ein: W2.employer_ein,
      employer_name: W2.employer_name,
      employee_name: `${W2.employee_firstname} ${W2.employee_lastname}`,
      wages: W2.wages,
      federal_income_tax_withheld: W2.federal_income_tax_withheld,
      social_security_wages: W2.social_security_wages,
      social_security_tax_withheld: W2.social_security_tax_withheld,
      medicare_wages: W2.medicare_wages,
      medicare_tax_withheld: W2.medicare_tax_withheld,
    },
  };
  await fs.writeFile(path.join(FIX, "w2", "sample2.ground_truth.json"), JSON.stringify(truth, null, 2) + "\n");
  console.log("✓ W-2 sample2 written");
};

// 1099-NEC — CopyA fields f1_* (PAYER block: f1_2 name/addr, f1_3 PAYER TIN, f1_4 RECIPIENT TIN,
// f1_5 recipient name, f1_6 street, f1_7 city/st/zip, f1_8 account; RightCol: f1_9 Box 1,
// f1_10 Box 4 fed tax withheld).
const fillNEC = async () => {
  const bytes = await fs.readFile(path.join(FIX, "1099_nec", "sample1.pdf"));
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_2[0]", `${NEC.payer_name}\n${NEC.payer_addr}`);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_3[0]", NEC.payer_tin);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_4[0]", NEC.recipient_tin);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_5[0]", NEC.recipient_name);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_6[0]", NEC.recipient_street);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_7[0]", NEC.recipient_citystatezip);
  setText(form, "topmostSubform[0].CopyA[0].LeftCol[0].f1_8[0]", NEC.account);
  setText(form, "topmostSubform[0].CopyA[0].RightCol[0].f1_9[0]", money(NEC.nonemployee_compensation));
  setText(form, "topmostSubform[0].CopyA[0].RightCol[0].f1_10[0]", money(NEC.federal_income_tax_withheld));

  form.flatten();
  const out = await pdf.save();
  await fs.writeFile(path.join(FIX, "1099_nec", "sample2.pdf"), out);

  const truth = {
    _note:
      "Synthetic-filled IRS 1099-NEC template (base PDF from irs.gov/pub/irs-pdf/f1099nec.pdf, Copy A filled). Values are fabricated — no PII.",
    doc_type: "1099_nec",
    fields: {
      payer_name: NEC.payer_name,
      payer_tin: NEC.payer_tin,
      recipient_name: NEC.recipient_name,
      recipient_tin: NEC.recipient_tin,
      nonemployee_compensation: NEC.nonemployee_compensation,
      federal_income_tax_withheld: NEC.federal_income_tax_withheld,
    },
  };
  await fs.writeFile(path.join(FIX, "1099_nec", "sample2.ground_truth.json"), JSON.stringify(truth, null, 2) + "\n");
  console.log("✓ 1099-NEC sample2 written");
};

// 1099-MISC — CopyA fields (same PAYER/RECIPIENT layout as NEC). RightCol:
// f1_9 Box 1 Rents, f1_10 Box 2 Royalties, f1_11 Box 3 Other Income, f1_12 Box 4 Fed Tax Withheld.
const fillMISC = async () => {
  const bytes = await fs.readFile(path.join(FIX, "1099_misc", "sample1.pdf"));
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_2[0]", `${MISC.payer_name}\n${MISC.payer_addr}`);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_3[0]", MISC.payer_tin);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_4[0]", MISC.recipient_tin);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_5[0]", MISC.recipient_name);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_6[0]", MISC.recipient_street);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_7[0]", MISC.recipient_citystatezip);
  setText(form, "topmostSubform[0].CopyA[0].LeftColumn[0].f1_8[0]", MISC.account);
  setText(form, "topmostSubform[0].CopyA[0].RightColumn[0].f1_9[0]", money(MISC.rents));
  setText(form, "topmostSubform[0].CopyA[0].RightColumn[0].f1_10[0]", money(MISC.royalties));
  setText(form, "topmostSubform[0].CopyA[0].RightColumn[0].f1_11[0]", money(MISC.other_income));
  setText(form, "topmostSubform[0].CopyA[0].RightColumn[0].f1_12[0]", money(MISC.federal_income_tax_withheld));

  form.flatten();
  const out = await pdf.save();
  await fs.writeFile(path.join(FIX, "1099_misc", "sample2.pdf"), out);

  const truth = {
    _note:
      "Synthetic-filled IRS 1099-MISC template (base PDF from irs.gov/pub/irs-pdf/f1099msc.pdf, Copy A filled). Values are fabricated — no PII.",
    doc_type: "1099_misc",
    fields: {
      payer_name: MISC.payer_name,
      payer_tin: MISC.payer_tin,
      recipient_name: MISC.recipient_name,
      recipient_tin: MISC.recipient_tin,
      rents: MISC.rents,
      royalties: MISC.royalties,
      other_income: MISC.other_income,
      federal_income_tax_withheld: MISC.federal_income_tax_withheld,
    },
  };
  await fs.writeFile(path.join(FIX, "1099_misc", "sample2.ground_truth.json"), JSON.stringify(truth, null, 2) + "\n");
  console.log("✓ 1099-MISC sample2 written");
};

// K-1 (Schedule K-1, Form 1065) — Part I / Part II / Part III.
// Field mapping from inspection of f1065sk1.pdf:
//   Part I (LeftCol): f1_6 Box A partnership EIN, f1_7 Box B partnership name/addr
//   Part II (LeftCol): f1_11 Box E partner TIN, f1_12 Box F partner name/addr
//   Part III (RightCol1): f1_34 Line 1 ordinary business income, f1_35 Line 2 net rental RE,
//     f1_36 Line 3, f1_37..f1_39 Line 4a/b/c guaranteed payments, f1_40 Line 5 interest,
//     f1_41 Line 6a ordinary dividends.
const fillK1 = async () => {
  const bytes = await fs.readFile(path.join(FIX, "k1", "sample1.pdf"));
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  setText(form, "topmostSubform[0].Page1[0].LeftCol[0].f1_6[0]", K1.partnership_ein);
  setText(form, "topmostSubform[0].Page1[0].LeftCol[0].f1_7[0]", `${K1.partnership_name}\n${K1.partnership_addr}`);
  setText(form, "topmostSubform[0].Page1[0].LeftCol[0].f1_8[0]", K1.ircenter_name);
  setText(form, "topmostSubform[0].Page1[0].LeftCol[0].f1_11[0]", K1.partner_tin);
  setText(form, "topmostSubform[0].Page1[0].LeftCol[0].f1_12[0]", `${K1.partner_name}\n${K1.partner_addr}`);
  setText(form, "topmostSubform[0].Page1[0].RightCol[0].RightCol1[0].f1_34[0]", String(K1.ordinary_business_income));
  setText(
    form,
    "topmostSubform[0].Page1[0].RightCol[0].RightCol1[0].f1_35[0]",
    String(K1.net_rental_real_estate_income)
  );
  setText(form, "topmostSubform[0].Page1[0].RightCol[0].RightCol1[0].f1_40[0]", String(K1.interest_income));
  setText(form, "topmostSubform[0].Page1[0].RightCol[0].RightCol1[0].f1_41[0]", String(K1.dividends));

  form.flatten();
  const out = await pdf.save();
  await fs.writeFile(path.join(FIX, "k1", "sample2.pdf"), out);

  const truth = {
    _note:
      "Synthetic-filled IRS Schedule K-1 (Form 1065) template (base PDF from irs.gov/pub/irs-pdf/f1065sk1.pdf, Page 1 Parts I/II/III filled). Values are fabricated — no PII. Line mapping: ordinary_business_income=Line 1, net_rental_real_estate_income=Line 2, interest_income=Line 5, dividends=Line 6a.",
    doc_type: "k1",
    fields: {
      partnership_name: K1.partnership_name,
      partnership_ein: K1.partnership_ein,
      partner_name: K1.partner_name,
      partner_tin: K1.partner_tin,
      ordinary_business_income: K1.ordinary_business_income,
      net_rental_real_estate_income: K1.net_rental_real_estate_income,
      interest_income: K1.interest_income,
      dividends: K1.dividends,
    },
  };
  await fs.writeFile(path.join(FIX, "k1", "sample2.ground_truth.json"), JSON.stringify(truth, null, 2) + "\n");
  console.log("✓ K-1 sample2 written");
};

await fillW2();
await fillNEC();
await fillMISC();
await fillK1();
console.log("\nDone. Inspect the sample2.pdf files visually if possible, then run: npm run extract:report");
