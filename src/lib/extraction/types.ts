export type StringField = {
  value: string;
  confidence: number;
};

export type NumberField = {
  value: number;
  confidence: number;
};

export type W2Fields = {
  employee_ssn: StringField;
  employer_ein: StringField;
  employer_name: StringField;
  employee_name: StringField;
  wages: NumberField;
  federal_income_tax_withheld: NumberField;
  social_security_wages: NumberField;
  social_security_tax_withheld: NumberField;
  medicare_wages: NumberField;
  medicare_tax_withheld: NumberField;
};

export type Nec1099Fields = {
  payer_name: StringField;
  payer_tin: StringField;
  recipient_name: StringField;
  recipient_tin: StringField;
  nonemployee_compensation: NumberField;
  federal_income_tax_withheld: NumberField;
};

export type Misc1099Fields = {
  payer_name: StringField;
  payer_tin: StringField;
  recipient_name: StringField;
  recipient_tin: StringField;
  rents: NumberField;
  royalties: NumberField;
  other_income: NumberField;
  federal_income_tax_withheld: NumberField;
};

export type K1Fields = {
  partnership_name: StringField;
  partnership_ein: StringField;
  partner_name: StringField;
  partner_tin: StringField;
  ordinary_business_income: NumberField;
  net_rental_real_estate_income: NumberField;
  interest_income: NumberField;
  dividends: NumberField;
};

export type DocType = ExtractionResult["doc_type"];

export type ExtractionResult =
  | { doc_type: "w2"; doc_type_confidence: number; fields: W2Fields }
  | { doc_type: "1099_nec"; doc_type_confidence: number; fields: Nec1099Fields }
  | { doc_type: "1099_misc"; doc_type_confidence: number; fields: Misc1099Fields }
  | { doc_type: "k1"; doc_type_confidence: number; fields: K1Fields }
  | { doc_type: "unknown"; doc_type_confidence: number; fields: null };
