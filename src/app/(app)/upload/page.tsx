import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import UploadDropzone from "@/components/upload/UploadDropzone";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const UploadPage = async (): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        eyebrow="Ingest"
        title="Upload tax documents"
        description="Drop up to 10 PDFs at once. Each file must be under 10 MB. We'll queue them for extraction."
      />
      <UploadDropzone />
    </div>
  );
};

export default UploadPage;
