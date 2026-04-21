import "server-only";

const buildAllowedOrigins = (): string[] => {
  const origins = new Set<string>();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const vercelUrl = process.env.VERCEL_URL;
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  if (siteUrl !== undefined && siteUrl !== "") {
    origins.add(siteUrl.replace(/\/$/, ""));
  }

  if (vercelUrl !== undefined && vercelUrl !== "") {
    origins.add(`https://${vercelUrl}`);
  }

  if (prodUrl !== undefined && prodUrl !== "") {
    origins.add(`https://${prodUrl}`);
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return Array.from(origins);
};

export const isSameOriginRequest = (request: Request): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin === null) {
    return fetchSite === "same-origin" || fetchSite === "none";
  }

  return buildAllowedOrigins().includes(origin);
};
