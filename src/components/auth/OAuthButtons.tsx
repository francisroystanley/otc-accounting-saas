"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildOAuthRedirectTo } from "@/lib/auth/oauth-callback";
import { getPublicBaseUrl } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type OAuthProvider = "google" | "azure";

type OAuthButtonsProps = {
  nextPath?: string;
};

const resolveRedirectTo = (nextPath: string | undefined): string => {
  return buildOAuthRedirectTo({
    publicBaseUrl: getPublicBaseUrl(),
    windowOrigin: window.location.origin,
    nextPath,
  });
};

const GoogleMark = () => {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1 2.6-2.1 3.4v2.8h3.4c2-1.8 3.2-4.5 3.2-7.7 0-.8-.1-1.6-.2-2.4z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.9 0 5.3-1 7-2.6l-3.4-2.8c-1 .7-2.2 1.1-3.6 1.1-2.8 0-5.1-1.9-5.9-4.4H2.5v2.8C4.2 19.6 7.8 22 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.1 13.3c-.2-.7-.3-1.4-.3-2.1s.1-1.4.3-2.1V6.3H2.5C1.7 7.9 1.3 9.6 1.3 11.2s.4 3.3 1.2 4.9z"
      />
      <path
        fill="#4285F4"
        d="M12 5.5c1.6 0 3 .5 4.1 1.5l3-3C17.3 2.3 14.9 1.3 12 1.3 7.8 1.3 4.2 3.7 2.5 7.2L6.1 10c.8-2.5 3.1-4.5 5.9-4.5z"
      />
    </svg>
  );
};

const MicrosoftMark = () => {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
};

const PROVIDER_LABEL: Readonly<Record<OAuthProvider, string>> = {
  google: "Google",
  azure: "Microsoft",
};

const OAuthButtons = ({ nextPath }: OAuthButtonsProps) => {
  const [pending, setPending] = useState<OAuthProvider | null>(null);

  const signInWith = async (provider: OAuthProvider): Promise<void> => {
    setPending(provider);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: resolveRedirectTo(nextPath) },
    });

    if (error !== null) {
      setPending(null);
      toast.error(`Couldn't start ${PROVIDER_LABEL[provider]} sign-in. Please try again.`);
    }
    // On success, the browser is redirected — no need to reset state.
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => {
          void signInWith("google");
        }}
      >
        <GoogleMark />
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => {
          void signInWith("azure");
        }}
      >
        <MicrosoftMark />
        {pending === "azure" ? "Redirecting…" : "Continue with Microsoft"}
      </Button>
    </div>
  );
};

export default OAuthButtons;
