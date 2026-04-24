import { redirect } from "next/navigation";
import DashboardTable from "@/app/(app)/dashboard/DashboardTable";
import PageHeader from "@/components/PageHeader";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";
import { type DocumentRow, parseDashboardSearchParams } from "@/lib/dashboard/live-feed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;

type DashboardPageProps = {
  searchParams: RawSearchParams;
};

const fetchInitialRows = async (workspaceId: string): Promise<DocumentRow[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error !== null || data === null) {
    return [];
  }

  return data;
};

const DashboardPage = async ({ searchParams }: DashboardPageProps): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  const raw = await searchParams;
  const initialParams = parseDashboardSearchParams(raw);
  const initialRows = await fetchInitialRows(auth.workspaceId);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        eyebrow="Workspace"
        title="Documents"
        description="Realtime status for everything uploaded into this workspace — upload, classify, review, export."
      />
      <DashboardTable workspaceId={auth.workspaceId} initialRows={initialRows} initialParams={initialParams} />
    </div>
  );
};

export default DashboardPage;
