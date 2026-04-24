import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_EMAIL_OTP_TYPES: ReadonlyArray<EmailOtpType> = [
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email",
  "email_change",
];

const isAllowedEmailOtpType = (value: string): value is EmailOtpType => {
  return ALLOWED_EMAIL_OTP_TYPES.some(allowed => {
    return allowed === value;
  });
};

export const GET = async (request: NextRequest): Promise<Response> => {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (tokenHash === null || typeParam === null || !isAllowedEmailOtpType(typeParam)) {
    redirect("/login?error=invalid_confirm_link");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeParam });

  if (error !== null) {
    redirect("/login?error=confirm_failed");
  }

  redirect(next);
};
