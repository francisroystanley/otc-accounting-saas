import { Client } from "@upstash/qstash";
import "server-only";
import { getPublicBaseUrl, getQstashToken, isQstashDisabled } from "@/lib/env";

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

const publishViaQStash = async (documentId: string): Promise<void> => {
  const client = new Client({ token: getQstashToken() });

  await client.publishJSON({
    url: resolveExtractEndpointUrl(),
    body: { documentId },
    flowControl: { key: FLOW_CONTROL_KEY, parallelism: FLOW_CONTROL_PARALLELISM },
    retries: PUBLISH_RETRIES,
  });
};

const publishViaDirectInvoke = async (documentId: string): Promise<void> => {
  const { handleExtract } = await import("@/app/api/extract/route");
  const request = new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  const response = await handleExtract(request);

  if (response.status >= 500) {
    throw new Error(`Direct handleExtract invocation failed with status ${response.status}`);
  }
};

export const publishExtract = async (documentId: string): Promise<void> => {
  if (isQstashDisabled()) {
    await publishViaDirectInvoke(documentId);

    return;
  }

  await publishViaQStash(documentId);
};
