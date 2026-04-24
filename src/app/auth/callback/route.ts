import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { type OAuthCallbackPort, resolveOAuthCallback } from "@/lib/auth/oauth-callback";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const GET = async (request: NextRequest): Promise<Response> => {
  const supabase = await createSupabaseServerClient();

  const port: OAuthCallbackPort = {
    exchangeCodeForSession: async code => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        return error === null ? { ok: true } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };

  const target = await resolveOAuthCallback(request, port);

  redirect(target);
};
