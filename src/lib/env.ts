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
  return readEnv("NEXT_PUBLIC_SUPABASE_URL");
};

export const getSupabasePublishableKey = (): string => {
  return readOptionalEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
};

export const getSupabaseServiceRoleKey = (): string => {
  return readEnv("SUPABASE_SERVICE_ROLE_KEY");
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
