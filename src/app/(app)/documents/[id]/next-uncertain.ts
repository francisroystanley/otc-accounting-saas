// Pure logic for the "Next uncertain" flow:
//   - a field is "uncertain" when its confidence is below CONFIDENCE_THRESHOLD and the
//     user has not yet edited it (the one-way latch in R13a)
//   - the button advances from the currently-focused field to the next uncertain one
//   - the iteration wraps around at the end of the form
//   - if the form has no uncertain fields, the result is null (callers hide the button)

export type UncertainInput = {
  fields: ReadonlyArray<string>;
  confidenceMap: Record<string, number | null>;
  editedFields: Record<string, boolean>;
  threshold: number;
};

export const isFieldUncertain = (
  fieldName: string,
  confidenceMap: Record<string, number | null>,
  editedFields: Record<string, boolean>,
  threshold: number
): boolean => {
  if (editedFields[fieldName] === true) {
    return false;
  }

  const confidence = confidenceMap[fieldName];

  if (confidence === null || confidence === undefined) {
    return false;
  }

  return confidence < threshold;
};

export const hasAnyUncertain = (input: UncertainInput): boolean => {
  for (const fieldName of input.fields) {
    if (isFieldUncertain(fieldName, input.confidenceMap, input.editedFields, input.threshold)) {
      return true;
    }
  }

  return false;
};

// Given the currently focused field (or null when no field has focus yet), return the
// next uncertain field name in DOM order. Wraps around to the beginning. Returns null
// when the form has no uncertain fields.
export const nextUncertainField = (input: UncertainInput, currentField: string | null): string | null => {
  if (input.fields.length === 0) {
    return null;
  }

  const startIndex = currentField === null ? -1 : input.fields.indexOf(currentField);

  for (let offset = 1; offset <= input.fields.length; offset += 1) {
    const index = (startIndex + offset + input.fields.length) % input.fields.length;
    const candidate = input.fields[index];

    if (candidate === undefined) {
      continue;
    }

    if (isFieldUncertain(candidate, input.confidenceMap, input.editedFields, input.threshold)) {
      return candidate;
    }
  }

  return null;
};
