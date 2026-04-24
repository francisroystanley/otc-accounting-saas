import { sanitizeNextPath } from "@/lib/auth/redirects";

export const buildOAuthRedirectTo = ({
  publicBaseUrl,
  windowOrigin,
  nextPath,
}: {
  publicBaseUrl: string | null;
  windowOrigin: string;
  nextPath?: string;
}): string => {
  const base = publicBaseUrl === null || publicBaseUrl === "" ? windowOrigin : publicBaseUrl;
  const callback = `${base.replace(/\/$/, "")}/auth/callback`;

  if (nextPath === undefined || nextPath === "") {
    return callback;
  }

  const url = new URL(callback);
  url.searchParams.set("next", nextPath);

  return url.toString();
};

export type OAuthExchangeResult = { ok: true } | { ok: false };

export type OAuthCallbackPort = {
  exchangeCodeForSession: (code: string) => Promise<OAuthExchangeResult>;
};

export const resolveOAuthCallback = async (request: Request, port: OAuthCallbackPort): Promise<string> => {
  const url = new URL(request.url);

  // Closed-vocabulary error routing: never forward raw provider text (see
  // docs/solutions/security-issues/open-redirect-via-next-query-param-supabase-verify-otp-2026-04-22.md).
  if (url.searchParams.get("error") !== null) {
    return "/login?error=oauth_failed";
  }

  const code = url.searchParams.get("code");

  if (code === null || code === "") {
    return "/login?error=oauth_failed";
  }

  const result = await port.exchangeCodeForSession(code);

  if (!result.ok) {
    return "/login?error=oauth_exchange_failed";
  }

  return sanitizeNextPath(url.searchParams.get("next"));
};
