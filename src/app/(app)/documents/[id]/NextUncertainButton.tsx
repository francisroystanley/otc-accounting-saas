"use client";

import { useCallback, useEffect } from "react";
import { type UncertainInput, hasAnyUncertain, nextUncertainField } from "@/app/(app)/documents/[id]/next-uncertain";
import { Button } from "@/components/ui/button";

type NextUncertainButtonProps = {
  fields: ReadonlyArray<string>;
  confidenceMap: Record<string, number | null>;
  editedFields: Record<string, boolean>;
  threshold: number;
  currentField: string | null;
  onAdvance: (fieldName: string) => void;
};

const NextUncertainButton = ({
  fields,
  confidenceMap,
  editedFields,
  threshold,
  currentField,
  onAdvance,
}: NextUncertainButtonProps): React.ReactElement | null => {
  const input: UncertainInput = { fields, confidenceMap, editedFields, threshold };
  const available = hasAnyUncertain(input);

  const advance = useCallback((): void => {
    const target = nextUncertainField({ fields, confidenceMap, editedFields, threshold }, currentField);

    if (target === null) {
      return;
    }

    onAdvance(target);
  }, [fields, confidenceMap, editedFields, threshold, currentField, onAdvance]);

  useEffect(() => {
    if (!available) {
      return;
    }

    const handler = (event: KeyboardEvent): void => {
      if (!event.altKey) {
        return;
      }

      if (event.key !== "n" && event.key !== "N") {
        return;
      }

      event.preventDefault();
      advance();
    };

    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [advance, available]);

  if (!available) {
    return null;
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={advance} data-slot="next-uncertain-button">
      Next uncertain <kbd className="ml-2 text-xs opacity-70">Alt+N</kbd>
    </Button>
  );
};

export default NextUncertainButton;
