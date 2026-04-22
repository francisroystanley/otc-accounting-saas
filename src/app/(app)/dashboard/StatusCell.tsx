"use client";

import { AlertCircleIcon } from "lucide-react";
import ConfidenceCountChip from "@/app/(app)/dashboard/ConfidenceCountChip";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type DocumentRow, countLowConfidence } from "@/lib/dashboard/live-feed";
import { CONFIDENCE_THRESHOLD } from "@/lib/extraction/config";

type StatusCellProps = {
  row: DocumentRow;
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const statusLabel: Record<DocumentRow["status"], string> = {
  pending: "Pending",
  processing: "Processing",
  complete: "Complete",
  failed: "Failed",
  needs_review: "Needs review",
};

const statusVariant: Record<DocumentRow["status"], BadgeVariant> = {
  pending: "outline",
  processing: "secondary",
  complete: "default",
  failed: "destructive",
  needs_review: "outline",
};

const StatusCell = ({ row }: StatusCellProps): React.ReactElement => {
  const label = statusLabel[row.status];
  const variant = statusVariant[row.status];
  const lowConfidence = countLowConfidence(row, CONFIDENCE_THRESHOLD);

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variant}>{label}</Badge>

      {row.status === "failed" ? (
        <Popover>
          <PopoverTrigger
            type="button"
            aria-label={`View error for ${row.filename}`}
            className="text-destructive hover:bg-destructive/10 focus-visible:ring-ring inline-flex size-5 items-center justify-center rounded focus:outline-none focus-visible:ring-2"
          >
            <AlertCircleIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="start" className="max-w-xs text-sm">
            <p className="text-muted-foreground mb-1 font-medium">Extraction failed</p>
            <p>{row.error_message ?? "No error details available."}</p>
          </PopoverContent>
        </Popover>
      ) : null}

      {row.status === "complete" ? <ConfidenceCountChip n={lowConfidence} /> : null}
    </div>
  );
};

export default StatusCell;
