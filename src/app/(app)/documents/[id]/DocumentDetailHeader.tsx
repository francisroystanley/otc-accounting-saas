"use client";

import { ChevronLeftIcon, FileQuestionIcon } from "lucide-react";
import { DOC_TYPE_SPECS, isDocType } from "@/app/(app)/documents/[id]/form-schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type DocumentRow, isUnrecognized } from "@/lib/dashboard/live-feed";

type DocumentDetailHeaderProps = {
  row: DocumentRow;
  onBack: () => void;
};

const STATUS_LABEL: Record<DocumentRow["status"], string> = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  failed: "Failed",
  needs_review: "Needs review",
};

const DocumentDetailHeader = ({ row, onBack }: DocumentDetailHeaderProps): React.ReactElement => {
  const docTypeLabel = isDocType(row.doc_type) ? DOC_TYPE_SPECS[row.doc_type].label : "Unknown type";
  const isUnrecognizedRow = isUnrecognized(row);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ChevronLeftIcon className="size-4" />
          Back to dashboard
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold break-all" title={row.filename}>
          {row.filename}
        </h1>
        <Badge variant="outline">{docTypeLabel}</Badge>
        {isUnrecognizedRow ? (
          <Badge variant="outline" className="text-muted-foreground gap-1">
            <FileQuestionIcon className="size-3.5" aria-hidden />
            Unrecognized
          </Badge>
        ) : (
          <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{STATUS_LABEL[row.status]}</Badge>
        )}
      </div>
    </div>
  );
};

export default DocumentDetailHeader;
