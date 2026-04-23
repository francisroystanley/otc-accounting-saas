"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import ConfidenceBadge from "@/app/(app)/documents/[id]/ConfidenceBadge";
import NextUncertainButton from "@/app/(app)/documents/[id]/NextUncertainButton";
import {
  DOC_TYPE_SPECS,
  type DocType,
  type FormValues,
  buildFormSchema,
  buildStoredExtractedData,
} from "@/app/(app)/documents/[id]/form-schemas";
import { isFieldUncertain } from "@/app/(app)/documents/[id]/next-uncertain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONFIDENCE_THRESHOLD } from "@/lib/extraction/config";

type ExtractedFieldsFormProps = {
  documentId: string;
  docType: DocType;
  initialValues: FormValues;
  confidenceMap: Record<string, number | null>;
  initialEditedFields: Record<string, boolean>;
  mode: "edit" | "complete_from_needs_review";
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

type SubmitResult = { ok: true } | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();

    if (isRecord(body) && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // fall through to status text
  }

  return `HTTP ${response.status}`;
};

const submitEdit = async (
  documentId: string,
  extractedData: Record<string, { value: string | number; confidence: number }>,
  editedFields: Record<string, boolean>
): Promise<SubmitResult> => {
  const editedTrueOnly: Record<string, true> = {};

  for (const [key, value] of Object.entries(editedFields)) {
    if (value === true) {
      editedTrueOnly[key] = true;
    }
  }

  const response = await fetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "edit",
      extracted_data: extractedData,
      edited_fields: editedTrueOnly,
    }),
  });

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true };
};

const submitNeedsReviewComplete = async (
  documentId: string,
  docType: DocType,
  extractedData: Record<string, { value: string | number; confidence: number }>
): Promise<SubmitResult> => {
  const response = await fetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "complete_from_needs_review",
      doc_type: docType,
      extracted_data: extractedData,
    }),
  });

  if (!response.ok) {
    return { ok: false, message: await readErrorMessage(response) };
  }

  return { ok: true };
};

const ExtractedFieldsForm = ({
  documentId,
  docType,
  initialValues,
  confidenceMap,
  initialEditedFields,
  mode,
  onSaved,
  onDirtyChange,
}: ExtractedFieldsFormProps): React.ReactElement => {
  const spec = DOC_TYPE_SPECS[docType];

  const fieldNames = useMemo(() => {
    return spec.fields.map(field => {
      return field.name;
    });
  }, [spec]);

  const schema = useMemo(() => {
    return buildFormSchema(docType);
  }, [docType]);

  const {
    control,
    handleSubmit,
    formState: { isDirty, isSubmitting },
    reset,
    setError,
    clearErrors,
  } = useForm<FormValues>({ defaultValues: initialValues });

  const [editedFields, setEditedFields] = useState<Record<string, boolean>>(initialEditedFields);
  const [currentField, setCurrentField] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Keep the parent's dirty state in sync for the unsaved-changes AlertDialog.
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const markEdited = useCallback((fieldName: string): void => {
    setEditedFields(current => {
      if (current[fieldName] === true) {
        return current;
      }

      return { ...current, [fieldName]: true };
    });
  }, []);

  const focusField = useCallback((fieldName: string): void => {
    const input = inputRefs.current[fieldName];

    if (input === null || input === undefined) {
      return;
    }

    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    setCurrentField(fieldName);
  }, []);

  const onSubmit = async (values: FormValues): Promise<void> => {
    clearErrors();

    const parsed = schema.safeParse(values);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];

        if (typeof field === "string") {
          setError(field, { type: "manual", message: issue.message });
        }
      }

      toast.error("Please fix the highlighted fields");

      return;
    }

    const stored = buildStoredExtractedData(docType, values, confidenceMap);

    const result =
      mode === "edit"
        ? await submitEdit(documentId, stored, editedFields)
        : await submitNeedsReviewComplete(documentId, docType, stored);

    if (!result.ok) {
      toast.error(`Save failed: ${result.message}`);

      return;
    }

    // Reset the form baseline so isDirty flips back to false after save.
    reset(values);
    toast.success("Saved");
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">{spec.label} fields</h2>
          <p className="text-muted-foreground text-xs">
            Fields with low model confidence show an amber dot. Edit any field to confirm it.
          </p>
        </div>
        <NextUncertainButton
          fields={fieldNames}
          confidenceMap={confidenceMap}
          editedFields={editedFields}
          threshold={CONFIDENCE_THRESHOLD}
          currentField={currentField}
          onAdvance={focusField}
        />
      </div>

      <div className="flex flex-col gap-3">
        {spec.fields.map(field => {
          const uncertain = isFieldUncertain(field.name, confidenceMap, editedFields, CONFIDENCE_THRESHOLD);
          const confidence = confidenceMap[field.name];

          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor={`field-${field.name}`} className="text-sm">
                  {field.label}
                </Label>
                {uncertain && typeof confidence === "number" ? <ConfidenceBadge confidence={confidence} /> : null}
              </div>

              <Controller
                name={field.name}
                control={control}
                render={({ field: controllerField, fieldState }) => {
                  return (
                    <>
                      <Input
                        {...controllerField}
                        id={`field-${field.name}`}
                        inputMode={field.kind === "number" ? "decimal" : "text"}
                        data-slot="extracted-field"
                        data-field-name={field.name}
                        ref={(element: HTMLInputElement | null) => {
                          controllerField.ref(element);
                          inputRefs.current[field.name] = element;
                        }}
                        onFocus={() => {
                          setCurrentField(field.name);
                        }}
                        onChange={event => {
                          markEdited(field.name);
                          controllerField.onChange(event);
                        }}
                        aria-invalid={fieldState.error !== undefined}
                      />
                      {fieldState.error !== undefined ? (
                        <p className="text-destructive text-xs">{fieldState.error.message}</p>
                      ) : null}
                    </>
                  );
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="border-border sticky bottom-0 -mx-4 mt-4 flex items-center justify-between gap-3 border-t px-4 py-3 backdrop-blur">
        <p className="text-muted-foreground text-xs">
          {isDirty
            ? "Unsaved changes"
            : mode === "complete_from_needs_review"
              ? "Fill in values, then save"
              : "No changes"}
        </p>
        <Button type="submit" disabled={isSubmitting || (mode === "edit" && !isDirty)}>
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
};

export default ExtractedFieldsForm;
