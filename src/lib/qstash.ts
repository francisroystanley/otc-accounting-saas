import { Client } from "@upstash/qstash";
import "server-only";
import { getPublicBaseUrl, getQstashToken, getQstashUrl } from "@/lib/env";

const FLOW_CONTROL_KEY = "extract";
const FLOW_CONTROL_PARALLELISM = 2;
const PUBLISH_RETRIES = 3;

const resolveExtractEndpointUrl = (): string => {
  const base = getPublicBaseUrl();

  if (base === null) {
    throw new Error(
      "Cannot resolve absolute URL for /api/extract. Set NEXT_PUBLIC_SITE_URL, VERCEL_PROJECT_PRODUCTION_URL, or VERCEL_URL."
    );
  }

  return `${base}/api/extract`;
};

export const publishExtract = async (documentId: string): Promise<void> => {
  const client = new Client({ token: getQstashToken(), baseUrl: getQstashUrl() });

  await client.publishJSON({
    url: resolveExtractEndpointUrl(),
    body: { documentId },
    flowControl: { key: FLOW_CONTROL_KEY, parallelism: FLOW_CONTROL_PARALLELISM },
    retries: PUBLISH_RETRIES,
  });
};
