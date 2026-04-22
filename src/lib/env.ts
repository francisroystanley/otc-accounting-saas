function readEnv(name: string): string;
function readEnv(name: string, isRequired: false): string | undefined;

function readEnv(name: string, isRequired = true): string | undefined {
  const value = process.env[name];

  if (value === undefined || value === "") {
    if (isRequired) {
      throw new Error(`Missing required environment variable: ${name}`);
    }

    return undefined;
  }

  return value;
}

export const getSupabaseUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (value === undefined || value === "") {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  return value;
};

export const getSupabasePublishableKey = (): string => {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (publishable !== undefined && publishable !== "") {
    return publishable;
  }

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (anon === undefined || anon === "") {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return anon;
};

export const getSupabaseServiceRoleKey = (): string => {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
};

export const getGoogleGenaiApiKey = (): string => {
  return readEnv("GOOGLE_GENAI_API_KEY");
};

export const getGeminiModelOverride = (): string | undefined => {
  return readEnv("GEMINI_MODEL", false);
};

export const getQstashToken = (): string => {
  return readEnv("QSTASH_TOKEN");
};

export const isQstashDisabled = (): boolean => {
  return readEnv("USE_QSTASH", false) === "false";
};

export const getPublicBaseUrl = (): string | null => {
  const siteUrl = readEnv("NEXT_PUBLIC_SITE_URL", false);

  if (siteUrl !== undefined) {
    return siteUrl.replace(/\/$/, "");
  }

  const prodUrl = readEnv("VERCEL_PROJECT_PRODUCTION_URL", false) ?? readEnv("VERCEL_URL", false);

  if (prodUrl !== undefined) {
    return `https://${prodUrl}`;
  }

  return null;
};
