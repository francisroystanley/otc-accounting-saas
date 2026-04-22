import { Badge } from "@/components/ui/badge";

type ConfidenceCountChipProps = {
  n: number;
};

const ConfidenceCountChip = ({ n }: ConfidenceCountChipProps): React.ReactElement | null => {
  if (n <= 0) {
    return null;
  }

  return (
    <Badge variant="secondary" aria-label={`${n} fields to review`}>
      {n} to review
    </Badge>
  );
};

export default ConfidenceCountChip;
