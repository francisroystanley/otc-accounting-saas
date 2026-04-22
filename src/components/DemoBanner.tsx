import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const DemoBanner = (): React.ReactElement => {
  return (
    <Alert className="border-yellow-400 bg-yellow-50 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-100">
      <TriangleAlertIcon className="text-yellow-600 dark:text-yellow-300" />
      <AlertDescription className="text-yellow-900 dark:text-yellow-100">
        Demo only: synthetic PDFs &mdash; do not upload real tax documents.
      </AlertDescription>
    </Alert>
  );
};

export default DemoBanner;
