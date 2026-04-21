import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

// Browser singleton is safe: publishable key is client-exposed by design and RLS is the security boundary.
let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export const createSupabaseBrowserClient = () => {
  if (cachedClient !== null) {
    return cachedClient;
  }

  cachedClient = createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());

  return cachedClient;
};
