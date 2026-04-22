import { redirect } from "next/navigation";
import DashboardTable from "@/app/(app)/dashboard/DashboardTable";
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
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Your documents</h1>
        <p className="text-muted-foreground text-sm">Realtime status for everything uploaded into this workspace.</p>
      </div>
      <DashboardTable workspaceId={auth.workspaceId} initialRows={initialRows} initialParams={initialParams} />
    </div>
  );
};

export default DashboardPage;
