"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type DeleteDocumentButtonProps = {
  id: string;
  filename: string;
  onOptimisticRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteConfirmed: (id: string) => void;
};

const DeleteDocumentButton = ({
  id,
  filename,
  onOptimisticRemove,
  onRestore,
  onDeleteConfirmed,
}: DeleteDocumentButtonProps): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    setIsSubmitting(true);
    onOptimisticRemove(id);

    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });

      if (!response.ok) {
        onRestore(id);
        toast.error("Couldn't delete — try again.");
      } else {
        onDeleteConfirmed(id);
        toast.success(`Deleted ${filename}`);
      }
    } catch (error) {
      console.error("[DeleteDocumentButton] delete failed", error);
      onRestore(id);
      toast.error("Couldn't delete — check your connection and try again.");
    } finally {
      setIsSubmitting(false);
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${filename}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this document?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes <span className="font-medium">{filename}</span> and its PDF from storage. This
            action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete document
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteDocumentButton;
