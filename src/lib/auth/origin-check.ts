import "server-only";
import { getPublicBaseUrl } from "@/lib/env";

const buildAllowedOrigins = (): string[] => {
  const origins = new Set<string>();
  const base = getPublicBaseUrl();

  if (base !== null) {
    origins.add(base);
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
