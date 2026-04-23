"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ConfidenceBadgeProps = {
  confidence: number;
};

const ConfidenceBadge = ({ confidence }: ConfidenceBadgeProps): React.ReactElement => {
  const percent = Math.round(confidence * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Low confidence: ${percent}%`}
          data-slot="confidence-badge"
          className="inline-block size-2 shrink-0 rounded-full bg-amber-500"
        />
      </TooltipTrigger>
      <TooltipContent>Low model confidence ({percent}%). Verify this value.</TooltipContent>
    </Tooltip>
  );
};

export default ConfidenceBadge;
