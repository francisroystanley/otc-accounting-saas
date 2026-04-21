import { createClient } from "@supabase/supabase-js";
import "server-only";
import type { Database } from "@/lib/database.types";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/env";

// Service-role client bypasses RLS. Only import from server-side code (R28c); see docs/solutions/security-issues/rls-cross-tenant-document-teleport-via-update-2026-04-21.md for blast-radius context.
if (typeof window !== "undefined") {
  throw new Error("@/lib/supabase/service must only be imported from server code.");
}

export const createSupabaseServiceRoleClient = () => {
  return createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};
