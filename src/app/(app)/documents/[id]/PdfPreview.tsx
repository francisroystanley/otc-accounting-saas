"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type PdfPreviewProps = {
  documentId: string;
  filename: string;
};

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; signedUrl: string; expiresAt: number }
  | { kind: "expired" }
  | { kind: "error"; message: string };

// Refresh the preview shortly before the signed URL expires so the iframe never
// renders with an already-dead URL. 60 seconds of slack on a 15-minute TTL.
const EXPIRY_SLACK_SECONDS = 60;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readSignedUrlResponse = (value: unknown): { signedUrl: string; expiresInSeconds: number } | null => {
  if (!isRecord(value)) {
    return null;
  }

  const signedUrl = value.signedUrl;
  const expiresInSeconds = value.expiresInSeconds;

  if (typeof signedUrl !== "string" || typeof expiresInSeconds !== "number") {
    return null;
  }

  return { signedUrl, expiresInSeconds };
};

const PdfPreview = ({ documentId, filename }: PdfPreviewProps): React.ReactElement => {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpiryTimer = useCallback((): void => {
    if (expiryTimerRef.current !== null) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  // Fetch the signed URL on mount and whenever `reloadToken` bumps. Consolidating
  // the fetch here (instead of a useCallback invoked from the effect) keeps the
  // effect body shape the linter accepts.
  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/documents/${documentId}/preview-url`, { method: "GET" });

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setState({ kind: "error", message: `HTTP ${response.status}` });

          return;
        }

        const body = readSignedUrlResponse(await response.json());

        if (cancelled) {
          return;
        }

        if (body === null) {
          setState({ kind: "error", message: "Invalid response" });

          return;
        }

        const expiresAt = Date.now() + body.expiresInSeconds * 1000;

        setState({ kind: "ready", signedUrl: body.signedUrl, expiresAt });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "network error";

        setState({ kind: "error", message });
      }
    };

    void load();

    return () => {
      cancelled = true;
      clearExpiryTimer();
    };
  }, [documentId, reloadToken, clearExpiryTimer]);

  useEffect(() => {
    if (state.kind !== "ready") {
      return;
    }

    clearExpiryTimer();

    const msUntilExpiry = state.expiresAt - Date.now() - EXPIRY_SLACK_SECONDS * 1000;
    const delay = msUntilExpiry > 0 ? msUntilExpiry : 0;

    expiryTimerRef.current = setTimeout(() => {
      setState({ kind: "expired" });
    }, delay);
  }, [state, clearExpiryTimer]);

  const handleReload = useCallback((): void => {
    setState({ kind: "loading" });
    setReloadToken(token => {
      return token + 1;
    });
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Loading preview…</div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">Couldn&apos;t load preview ({state.message}).</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            handleReload();
            toast.success("Reloading preview…");
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (state.kind === "expired") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">Preview expired — click to reload.</p>
        <Button type="button" variant="outline" size="sm" onClick={handleReload}>
          Reload preview
        </Button>
      </div>
    );
  }

  return (
    <iframe
      src={state.signedUrl}
      title={`Preview: ${filename}`}
      className="h-full w-full rounded-md border"
      data-slot="pdf-preview-iframe"
    />
  );
};

export default PdfPreview;
