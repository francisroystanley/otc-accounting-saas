"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSupportedTypesList } from "@/app/(app)/documents/[id]/unrecognized-copy";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type UnrecognizedEmptyStateProps = {
  documentId: string;
  filename: string;
};

const UnrecognizedEmptyState = ({ documentId, filename }: UnrecognizedEmptyStateProps): React.ReactElement => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const supportedTypes = formatSupportedTypesList();

  const handleConfirm = async (): Promise<void> => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });

      if (!response.ok) {
        setErrorMessage("Couldn't remove — try again.");
        setIsSubmitting(false);
        console.error(`[UnrecognizedEmptyState] DELETE returned ${response.status}`);

        return;
      }

      // Close the dialog before navigating so the unmount happens cleanly while
      // the component is still mounted. Navigating first can race with the dialog's
      // unmount and warn about state updates on an unmounted component.
      setOpen(false);
      router.push("/dashboard");
    } catch (error) {
      console.error("[UnrecognizedEmptyState] DELETE failed", error);
      setErrorMessage("Couldn't remove — try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">No data extracted</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This file couldn&apos;t be read as a supported tax form ({supportedTypes}). It may be blank, a form we
          don&apos;t currently handle, or too poorly scanned to parse.
        </p>
      </div>

      <div>
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" size="default">
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove unrecognized document?</AlertDialogTitle>
              <AlertDialogDescription>
                This PDF (<span className="font-medium">{filename}</span>) couldn&apos;t be read. Removing it won&apos;t
                affect your tax documents.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isSubmitting}>Keep</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                size="default"
                disabled={isSubmitting}
                onClick={() => {
                  void handleConfirm();
                }}
              >
                Remove
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {errorMessage !== null ? (
          <p role="alert" className="text-destructive mt-2 text-sm">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default UnrecognizedEmptyState;
