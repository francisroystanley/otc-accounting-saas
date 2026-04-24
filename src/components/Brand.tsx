import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandProps = {
  asLink?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const wordmarkSize: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
};

const markSize: Record<NonNullable<BrandProps["size"]>, string> = {
  sm: "size-1.5",
  md: "size-2",
  lg: "size-2.5",
};

const Wordmark = ({ size }: { size: NonNullable<BrandProps["size"]> }): React.ReactElement => {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden="true" className={cn("bg-brand rounded-xs", markSize[size])} />
      <span className={cn("text-foreground font-semibold tracking-[-0.01em]", wordmarkSize[size])}>OTC Accounting</span>
    </span>
  );
};

const Brand = ({ asLink = true, size = "md", className }: BrandProps): React.ReactElement => {
  if (!asLink) {
    return (
      <span role="img" aria-label="OTC Accounting" className={cn("inline-flex items-center", className)}>
        <Wordmark size={size} />
      </span>
    );
  }

  return (
    <Link
      href="/dashboard"
      aria-label="OTC Accounting — go to dashboard"
      className={cn("inline-flex items-center", className)}
    >
      <Wordmark size={size} />
    </Link>
  );
};

export default Brand;
