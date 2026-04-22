const readEnv = (name: string): string => {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];

  return value === undefined || value === "" ? undefined : value;
};

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
  return readOptionalEnv("GEMINI_MODEL");
};

export const getQstashToken = (): string => {
  return readEnv("QSTASH_TOKEN");
};

export const isQstashDisabled = (): boolean => {
  return readOptionalEnv("USE_QSTASH") === "false";
};

export const getPublicBaseUrl = (): string | null => {
  const siteUrl = readOptionalEnv("NEXT_PUBLIC_SITE_URL");

  if (siteUrl !== undefined) {
    return siteUrl.replace(/\/$/, "");
  }

  const prodUrl = readOptionalEnv("VERCEL_PROJECT_PRODUCTION_URL") ?? readOptionalEnv("VERCEL_URL");

  if (prodUrl !== undefined) {
    return `https://${prodUrl}`;
  }

  return null;
};
