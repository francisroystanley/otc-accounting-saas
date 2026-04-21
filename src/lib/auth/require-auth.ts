import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuthenticatedContext = {
  userId: string;
  workspaceId: string;
};

export const getAuthenticatedContext = async (): Promise<AuthenticatedContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

  if (claimsError !== null || claimsData === null) {
    return null;
  }

  const userId = claimsData.claims.sub;

  if (typeof userId !== "string" || userId === "") {
    return null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError !== null || membership === null) {
    return null;
  }

  return { userId, workspaceId: membership.workspace_id };
};
