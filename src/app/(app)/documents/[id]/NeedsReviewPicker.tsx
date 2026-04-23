"use client";

import { useState } from "react";
import { DOC_TYPE_SPECS, type DocType, SUPPORTED_DOC_TYPES, isDocType } from "@/app/(app)/documents/[id]/form-schemas";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type NeedsReviewPickerProps = {
  onPick: (docType: DocType) => void;
};

const NeedsReviewPicker = ({ onPick }: NeedsReviewPickerProps): React.ReactElement => {
  const [draft, setDraft] = useState<DocType | "">("");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div>
        <h2 className="text-sm font-medium">This document needs review</h2>
        <p className="text-muted-foreground text-sm">
          Gemini wasn&apos;t confident about what form this is. Pick the correct type to continue, then fill the form
          below.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={draft}
          onValueChange={(value: string) => {
            if (isDocType(value)) {
              setDraft(value);
            }
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Pick document type…" />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_DOC_TYPES.map(docType => {
              return (
                <SelectItem key={docType} value={docType}>
                  {DOC_TYPE_SPECS[docType].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          disabled={draft === ""}
          onClick={() => {
            if (draft !== "") {
              onPick(draft);
            }
          }}
        >
          Use this type
        </Button>
      </div>
    </div>
  );
};

export default NeedsReviewPicker;
