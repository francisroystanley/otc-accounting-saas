"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CheckCircle2Icon, OctagonXIcon, UploadCloudIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type FinalizeResult,
  type PutResult,
  type SignResult,
  type UploadBatchPort,
  type UploadOneResult,
  type UploadStage,
  preCheckBatch,
  uploadOne,
  userMessageForCode,
} from "@/lib/upload/client-batch";

const STORAGE_BUCKET = "documents";
const PDF_CONTENT_TYPE = "application/pdf";

const signResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    signedUrl: z.string(),
    token: z.string(),
    documentId: z.string(),
    storagePath: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
  }),
]);

const finalizeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    documentId: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
  }),
]);

type RowStatus = "queued" | "in_progress" | "done" | "failed";

type RowState = {
  rowId: string;
  filename: string;
  stage: UploadStage;
  percent: number;
  status: RowStatus;
  errorCode: string | null;
};

type Action =
  | { type: "add"; rows: RowState[] }
  | { type: "progress"; rowId: string; stage: UploadStage; percent: number }
  | { type: "settle"; rowId: string; result: UploadOneResult }
  | { type: "reset" };

const isTerminal = (status: RowStatus): boolean => {
  return status === "done" || status === "failed";
};

const rowsReducer = (state: RowState[], action: Action): RowState[] => {
  switch (action.type) {
    case "add": {
      return [...state, ...action.rows];
    }

    case "progress": {
      return state.map((row: RowState): RowState => {
        if (row.rowId !== action.rowId || isTerminal(row.status)) {
          return row;
        }

        const status: RowStatus = action.stage === "failed" ? "failed" : "in_progress";

        return { ...row, stage: action.stage, percent: action.percent, status };
      });
    }

    case "settle": {
      return state.map((row: RowState): RowState => {
        if (row.rowId !== action.rowId) {
          return row;
        }

        if (action.result.ok) {
          return { ...row, stage: "done", percent: 100, status: "done", errorCode: null };
        }

        return {
          ...row,
          stage: "failed",
          percent: 100,
          status: "failed",
          errorCode: action.result.code,
        };
      });
    }

    case "reset": {
      return [];
    }

    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
};

const parseJsonSafely = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    console.error("[upload] response.json() failed", error);

    return null;
  }
};

const signUploadViaApi = async (filename: string): Promise<SignResult> => {
  let response: Response;

  try {
    response = await fetch("/api/upload/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename }),
    });
  } catch (error) {
    console.error("[upload] /api/upload/sign fetch failed", error);

    return { ok: false, code: "network_error" };
  }

  if (!response.ok && response.status >= 500) {
    console.error(`[upload] /api/upload/sign returned ${response.status}`);

    return { ok: false, code: "network_error" };
  }

  const raw = await parseJsonSafely(response);

  if (raw === null) {
    return { ok: false, code: "network_error" };
  }

  const parsed = signResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, code: "invalid_payload" };
  }

  return parsed.data;
};

const finalizeUploadViaApi = async (args: {
  documentId: string;
  filename: string;
  storagePath: string;
}): Promise<FinalizeResult> => {
  let response: Response;

  try {
    response = await fetch("/api/upload/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (error) {
    console.error("[upload] /api/upload/finalize fetch failed", error);

    return { ok: false, code: "network_error" };
  }

  if (!response.ok && response.status >= 500) {
    console.error(`[upload] /api/upload/finalize returned ${response.status}`);

    return { ok: false, code: "network_error" };
  }

  const raw = await parseJsonSafely(response);

  if (raw === null) {
    return { ok: false, code: "network_error" };
  }

  const parsed = finalizeResponseSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, code: "invalid_payload" };
  }

  if (parsed.data.ok) {
    return { ok: true, documentId: parsed.data.documentId };
  }

  return { ok: false, code: parsed.data.code };
};

const putToStorage = async (token: string, file: File, storagePath: string): Promise<PutResult> => {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).uploadToSignedUrl(storagePath, token, file, {
    contentType: PDF_CONTENT_TYPE,
    upsert: false,
  });

  if (error !== null) {
    return { ok: false };
  }

  return { ok: true };
};

const hasPendingRows = (rows: RowState[]): boolean => {
  return rows.some((row: RowState): boolean => {
    return !isTerminal(row.status);
  });
};

const UploadDropzone = (): React.ReactElement => {
  const [rows, dispatch] = useReducer(rowsReducer, []);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const rowsRef = useRef<RowState[]>([]);
  const activeRowIdsRef = useRef<Set<string>>(new Set());

  useEffect((): void => {
    rowsRef.current = rows;
  }, [rows]);

  const isBatchComplete =
    rows.length > 0 &&
    rows.every((row: RowState): boolean => {
      return isTerminal(row.status);
    });

  const handleBatch = useCallback((fileList: FileList | null): void => {
    if (fileList === null || fileList.length === 0) {
      return;
    }

    if (hasPendingRows(rowsRef.current)) {
      toast.error("Wait for the current batch to finish before dropping more files.");

      return;
    }

    const files: File[] = [];

    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList.item(i);

      if (file !== null) {
        files.push(file);
      }
    }

    const { accepted, rejected } = preCheckBatch(files);

    for (const { file, code } of rejected) {
      toast.error(`${file.name} — ${userMessageForCode(code)}`);
    }

    if (accepted.length === 0) {
      return;
    }

    const seededRows: RowState[] = accepted.map((file: File): RowState => {
      return {
        rowId: crypto.randomUUID(),
        filename: file.name,
        stage: "queued",
        percent: 0,
        status: "queued",
        errorCode: null,
      };
    });

    for (const row of seededRows) {
      activeRowIdsRef.current.add(row.rowId);
    }

    dispatch({ type: "add", rows: seededRows });

    const tasks = accepted.map(async (file: File, index: number): Promise<UploadOneResult> => {
      const seededRow = seededRows[index];

      if (seededRow === undefined) {
        return { ok: false, filename: file.name, code: "network_error" };
      }

      const { rowId } = seededRow;

      const port: UploadBatchPort = {
        signUpload: signUploadViaApi,
        putToStorage,
        finalizeUpload: finalizeUploadViaApi,
        onProgress: (stage: UploadStage, percent: number): void => {
          dispatch({ type: "progress", rowId, stage, percent });
        },
      };

      const result = await uploadOne(file, port);

      dispatch({ type: "settle", rowId, result });

      if (activeRowIdsRef.current.has(rowId)) {
        if (result.ok) {
          toast.success(`Queued: ${result.filename}`);
        } else {
          toast.error(`${result.filename} — ${userMessageForCode(result.code)}`);
        }
      }

      return result;
    });

    void Promise.allSettled(tasks);
  }, []);

  const onDragEnter = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const onDragOver = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
  };

  const onDragLeave = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    handleBatch(event.dataTransfer.files);
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    handleBatch(event.target.files);

    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }
  };

  const onReset = (): void => {
    activeRowIdsRef.current.clear();
    dispatch({ type: "reset" });
  };

  return (
    <div className="flex flex-col gap-6">
      <label
        htmlFor="upload-input"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`border-muted-foreground/30 hover:border-muted-foreground/60 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "bg-muted/20"
        }`}
        aria-label="Drop PDFs or click to choose"
      >
        <UploadCloudIcon className="text-muted-foreground size-8" aria-hidden />
        <div className="flex flex-col gap-1">
          <span className="text-base font-medium">Drop PDFs here or click to choose</span>
          <span className="text-muted-foreground text-xs">Up to 10 files, 10 MB each</span>
        </div>
        <input
          id="upload-input"
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf"
          className="sr-only"
          onChange={onInputChange}
        />
      </label>

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-live="polite">
          {rows.map((row: RowState): React.ReactElement => {
            return (
              <li key={row.rowId} className="bg-card flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1 truncate font-mono text-xs" title={row.filename}>
                  {row.filename}
                </span>
                <div className="bg-muted h-1.5 w-32 overflow-hidden rounded-full">
                  <div
                    className={`h-full transition-all ${row.status === "failed" ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${row.percent}%` }}
                  />
                </div>
                <span className="text-muted-foreground min-w-16 text-xs capitalize">{row.stage}</span>
                {row.status === "done" ? (
                  <CheckCircle2Icon className="text-primary size-4" aria-label="Queued" />
                ) : row.status === "failed" ? (
                  <OctagonXIcon className="text-destructive size-4" aria-label="Failed" />
                ) : (
                  <span className="size-4" aria-hidden />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {isBatchComplete ? (
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onReset}>
            Upload more
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard">View dashboard</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default UploadDropzone;
