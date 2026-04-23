import { notFound, redirect } from "next/navigation";
import DocumentDetail from "@/app/(app)/documents/[id]/DocumentDetail";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import type { DocumentRow } from "@/lib/dashboard/live-feed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const fetchDocument = async (workspaceId: string, documentId: string): Promise<DocumentRow | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error !== null || data === null) {
    return null;
  }

  return data;
};

type DocumentDetailPageProps = {
  params: Promise<{ id: string }>;
};

const DocumentDetailPage = async ({ params }: DocumentDetailPageProps): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  const { id } = await params;
  const row = await fetchDocument(auth.workspaceId, id);

  if (row === null) {
    notFound();
  }

  return <DocumentDetail row={row} />;
};

export default DocumentDetailPage;
