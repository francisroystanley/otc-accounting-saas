import { FileTextIcon, UploadCloudIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type EmptyStateProps = {
  variant: "no-documents" | "no-matches";
};

const EmptyState = ({ variant }: EmptyStateProps): React.ReactElement => {
  if (variant === "no-documents") {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
        <div className="bg-brand/10 text-brand flex size-12 items-center justify-center rounded-md">
          <UploadCloudIcon className="size-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-foreground text-base font-semibold tracking-tight">No documents yet</p>
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">
            Drop a few PDFs and we&apos;ll classify, extract the fields, and queue them for your review.
          </p>
        </div>
        <Button asChild size="default" className="bg-brand hover:bg-brand/90 text-brand-foreground">
          <Link href="/upload">
            <UploadCloudIcon className="size-4" aria-hidden="true" />
            Upload your first PDF
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <FileTextIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">No documents match your filters</p>
        <p className="text-muted-foreground text-xs">Try clearing the search or status filter.</p>
      </div>
    </div>
  );
};

export default EmptyState;
