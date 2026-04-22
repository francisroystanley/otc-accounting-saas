import { redirect } from "next/navigation";
import UploadDropzone from "@/components/upload/UploadDropzone";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const UploadPage = async (): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Upload tax documents</h1>
        <p className="text-muted-foreground text-sm">
          Drop up to 10 PDFs at once. Each file must be under 10 MB. We&apos;ll queue them for extraction.
        </p>
      </div>
      <UploadDropzone />
    </div>
  );
};

export default UploadPage;
