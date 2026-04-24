import { DOC_TYPE_SPECS, SUPPORTED_DOC_TYPES } from "@/app/(app)/documents/[id]/form-schemas";

// Returns "W-2, 1099-NEC, 1099-MISC, or K-1" for the current four-type roster.
// Derived from SUPPORTED_DOC_TYPES + DOC_TYPE_SPECS at call time so adding a new
// doc type (e.g. 1099-K) flows through without editing this helper or its consumers.
export const formatSupportedTypesList = (): string => {
  const labels = SUPPORTED_DOC_TYPES.map(docType => {
    return DOC_TYPE_SPECS[docType].label;
  });

  if (labels.length === 0) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0] ?? "";
  }

  const last = labels[labels.length - 1];
  const rest = labels.slice(0, -1);

  return `${rest.join(", ")}, or ${last}`;
};
