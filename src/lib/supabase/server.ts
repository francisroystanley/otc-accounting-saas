import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";

// Server client uses Next 16 async cookies(); mutation throws are swallowed because proxy.ts owns the cookie refresh loop.
export const createSupabaseServerClient = async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll: () => {
        return cookieStore.getAll();
      },
      setAll: cookiesToSet => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot mutate cookies; proxy.ts refreshes them on the next request.
        }
      },
    },
  });
};
