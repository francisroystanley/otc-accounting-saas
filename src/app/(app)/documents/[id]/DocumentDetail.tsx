"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DocumentDetailHeader from "@/app/(app)/documents/[id]/DocumentDetailHeader";
import ExtractedFieldsForm from "@/app/(app)/documents/[id]/ExtractedFieldsForm";
import NeedsReviewPicker from "@/app/(app)/documents/[id]/NeedsReviewPicker";
import PdfPreview from "@/app/(app)/documents/[id]/PdfPreview";
import {
  type DocType,
  type FormValues,
  emptyFormValuesFor,
  extractConfidenceMapFrom,
  extractFormValuesFrom,
  isDocType,
} from "@/app/(app)/documents/[id]/form-schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DocumentRow } from "@/lib/dashboard/live-feed";

type DocumentDetailProps = {
  row: DocumentRow;
};

type PendingNavigation = { kind: "idle" } | { kind: "pending"; path: string };

type InitialFormInputs = {
  docType: DocType;
  values: FormValues;
  confidenceMap: Record<string, number | null>;
  editedFields: Record<string, boolean>;
};

const readEditedFields = (raw: unknown): Record<string, boolean> => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const out: Record<string, boolean> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === true) {
      out[key] = true;
    }
  }

  return out;
};

const buildInitialsForEdit = (row: DocumentRow): InitialFormInputs | null => {
  if (!isDocType(row.doc_type)) {
    return null;
  }

  return {
    docType: row.doc_type,
    values: extractFormValuesFrom(row.doc_type, row.extracted_data),
    confidenceMap: extractConfidenceMapFrom(row.doc_type, row.extracted_data),
    editedFields: readEditedFields(row.edited_fields),
  };
};

const buildInitialsForPickedType = (docType: DocType): InitialFormInputs => {
  const confidenceMap: Record<string, number | null> = {};

  return {
    docType,
    values: emptyFormValuesFor(docType),
    confidenceMap,
    editedFields: {},
  };
};

const DocumentDetail = ({ row }: DocumentDetailProps): React.ReactElement => {
  const router = useRouter();
  const [pickedType, setPickedType] = useState<DocType | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation>({ kind: "idle" });

  // Intercept hard-reload / tab-close on dirty forms.
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handler = (event: BeforeUnloadEvent): string => {
      event.preventDefault();

      return "";
    };

    window.addEventListener("beforeunload", handler);

    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [isDirty]);

  const requestNavigateBack = useCallback((): void => {
    if (isDirty) {
      setPendingNavigation({ kind: "pending", path: "/dashboard" });

      return;
    }

    router.push("/dashboard");
  }, [isDirty, router]);

  const handleConfirmDiscard = useCallback((): void => {
    if (pendingNavigation.kind !== "pending") {
      return;
    }

    const path = pendingNavigation.path;

    setPendingNavigation({ kind: "idle" });
    setIsDirty(false);
    router.push(path);
  }, [pendingNavigation, router]);

  const handleCancelDiscard = useCallback((): void => {
    setPendingNavigation({ kind: "idle" });
  }, []);

  const handlePickType = useCallback(
    (docType: DocType) => {
      if (isDirty) {
        const confirmed = window.confirm(
          "Change document type and discard current form values? This cannot be undone."
        );

        if (!confirmed) {
          return;
        }
      }

      setIsDirty(false);
      setPickedType(docType);
    },
    [isDirty]
  );

  const handleSaved = useCallback((): void => {
    router.refresh();
  }, [router]);

  // Decide what the form component should render:
  //   1. complete rows → edit the existing fields
  //   2. needs_review rows that the user has not picked yet → show only the picker
  //   3. needs_review rows after the user picks a type → empty form for that type
  //   4. all other statuses → read-only view with links back to dashboard
  const inputs = ((): InitialFormInputs | null => {
    if (row.status === "complete") {
      return buildInitialsForEdit(row);
    }

    if (row.status === "needs_review" && pickedType !== null) {
      return buildInitialsForPickedType(pickedType);
    }

    return null;
  })();

  const formMode: "edit" | "complete_from_needs_review" =
    row.status === "complete" ? "edit" : "complete_from_needs_review";

  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col gap-4">
        <DocumentDetailHeader row={row} onBack={requestNavigateBack} />

        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="border-border bg-muted/30 min-h-130 overflow-hidden rounded-lg border lg:h-[calc(100vh-220px)]">
            <PdfPreview documentId={row.id} filename={row.filename} />
          </div>

          <div className="flex flex-col gap-4">
            {row.status === "needs_review" && pickedType === null ? (
              <NeedsReviewPicker onPick={handlePickType} />
            ) : null}

            {row.status === "needs_review" && pickedType !== null && inputs !== null ? (
              <ExtractedFieldsForm
                key={`needs-review-${pickedType}`}
                documentId={row.id}
                docType={inputs.docType}
                initialValues={inputs.values}
                confidenceMap={inputs.confidenceMap}
                initialEditedFields={inputs.editedFields}
                mode="complete_from_needs_review"
                onSaved={handleSaved}
                onDirtyChange={setIsDirty}
              />
            ) : null}

            {row.status === "complete" && inputs !== null ? (
              <ExtractedFieldsForm
                key={`edit-${row.id}-${inputs.docType}`}
                documentId={row.id}
                docType={inputs.docType}
                initialValues={inputs.values}
                confidenceMap={inputs.confidenceMap}
                initialEditedFields={inputs.editedFields}
                mode={formMode}
                onSaved={handleSaved}
                onDirtyChange={setIsDirty}
              />
            ) : null}

            {row.status === "pending" || row.status === "processing" ? (
              <div className="text-muted-foreground rounded-lg border p-4 text-sm">
                Extraction is still running. This view will update automatically once it finishes.
              </div>
            ) : null}

            {row.status === "failed" ? (
              <div className="bg-destructive/5 border-destructive/30 rounded-lg border p-4 text-sm">
                <p className="font-medium">Extraction failed.</p>
                {row.error_message !== null ? (
                  <p className="text-muted-foreground mt-1 wrap-break-word">{row.error_message}</p>
                ) : null}
                <p className="text-muted-foreground mt-2">
                  Head back to the{" "}
                  <Link href="/dashboard" className="underline">
                    dashboard
                  </Link>{" "}
                  to delete and re-upload.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <AlertDialog
        open={pendingNavigation.kind === "pending"}
        onOpenChange={open => {
          if (!open) {
            handleCancelDiscard();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits to this document have not been saved. Leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default" onClick={handleCancelDiscard}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" size="default" onClick={handleConfirmDiscard}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};

export default DocumentDetail;
