"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import DashboardFilters from "@/app/(app)/dashboard/DashboardFilters";
import DeleteDocumentButton from "@/app/(app)/dashboard/DeleteDocumentButton";
import StatusCell from "@/app/(app)/dashboard/StatusCell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type DashboardSearchParams,
  type DocumentRow,
  type FeedEvent,
  applyEvent,
  filterByParams,
  matchesSearch,
  mergeEvents,
} from "@/lib/dashboard/live-feed";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type DashboardTableProps = {
  workspaceId: string;
  initialRows: DocumentRow[];
  initialParams: DashboardSearchParams;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  "w2": "W-2",
  "1099_nec": "1099-NEC",
  "1099_misc": "1099-MISC",
  "k1": "K-1",
};

const formatDocType = (value: string | null): string => {
  if (value === null) {
    return "—";
  }

  return DOC_TYPE_LABELS[value] ?? value;
};

const formatDate = (iso: string): string => {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isDocumentRow = (value: unknown): value is DocumentRow => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.workspace_id === "string" &&
    typeof value.filename === "string" &&
    typeof value.status === "string" &&
    typeof value.storage_path === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
};

type DeletePayloadIdentity = { id: string; workspace_id: string };

const extractDeleteIdentity = (value: unknown): DeletePayloadIdentity | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.id !== "string" || typeof value.workspace_id !== "string") {
    return null;
  }

  return { id: value.id, workspace_id: value.workspace_id };
};

const buildExportUrl = (params: DashboardSearchParams): string => {
  const search = new URLSearchParams();

  if (params.type !== null) {
    search.set("type", params.type);
  }

  if (params.status !== null) {
    search.set("status", params.status);
  }

  if (params.q !== null && params.q !== "") {
    search.set("q", params.q);
  }

  const query = search.toString();

  return query === "" ? "/api/export" : `/api/export?${query}`;
};

const FALLBACK_EXPORT_FILENAME = "otc-export.zip";

const parseAttachmentFilename = (disposition: string | null): string => {
  if (disposition === null) {
    return FALLBACK_EXPORT_FILENAME;
  }

  // content-disposition: attachment; filename="otc-export-YYYYMMDD-HHmm.zip"
  const match = disposition.match(/filename="([^"]+)"/);

  return match === null ? FALLBACK_EXPORT_FILENAME : match[1];
};

const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Firefox aborts the in-flight download if the blob URL is revoked synchronously
  // after click(). Defer revocation to the next tick so the browser has grabbed the
  // blob first.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

const initialFailedToastedIds = (rows: DocumentRow[]): Set<string> => {
  const set = new Set<string>();

  for (const row of rows) {
    if (row.status === "failed") {
      set.add(row.id);
    }
  }

  return set;
};

const DashboardTable = ({ workspaceId, initialRows, initialParams }: DashboardTableProps): React.ReactElement => {
  const [rows, setRows] = useState<DocumentRow[]>(initialRows);
  const [params, setParams] = useState<DashboardSearchParams>(initialParams);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const failedToastedIds = useRef<Set<string>>(initialFailedToastedIds(initialRows));
  const restoreBufferRef = useRef<Map<string, DocumentRow>>(new Map());

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const buffer: FeedEvent[] = [];
    let hydrated = false;
    let cancelled = false;

    const toFeedEventFromPayload = (
      eventType: "INSERT" | "UPDATE" | "DELETE",
      next: unknown,
      prev: unknown
    ): FeedEvent | null => {
      if (eventType === "DELETE") {
        const identity = extractDeleteIdentity(prev);

        if (identity === null) {
          return null;
        }

        return { kind: "delete", id: identity.id, workspaceId: identity.workspace_id };
      }

      if (!isDocumentRow(next)) {
        return null;
      }

      return eventType === "INSERT" ? { kind: "insert", row: next } : { kind: "update", row: next };
    };

    const maybeToastFailed = (row: DocumentRow): void => {
      if (row.status !== "failed") {
        return;
      }

      if (failedToastedIds.current.has(row.id)) {
        return;
      }

      failedToastedIds.current.add(row.id);
      toast.error(`Extraction failed: ${row.filename}`);
    };

    const channel = supabase
      .channel(`documents:w:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        payload => {
          const event = toFeedEventFromPayload(payload.eventType, payload.new, payload.old);

          if (event === null) {
            return;
          }

          if (!hydrated) {
            buffer.push(event);

            return;
          }

          setRows(current => {
            return applyEvent(current, event, workspaceId);
          });

          if (event.kind !== "delete") {
            maybeToastFailed(event.row);
          }
        }
      )
      .subscribe();

    const hydrate = async (): Promise<void> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });

      if (cancelled) {
        return;
      }

      if (error !== null || data === null) {
        // Flip the flag so subsequent events stop buffering and apply directly.
        hydrated = true;
        toast.error("Couldn't refresh — reconnecting…");

        return;
      }

      // Atomically drain the buffer and flip hydrated=true so events that arrive between
      // mergeEvents and the flag don't get toasted-but-dropped.
      const pending = buffer.splice(0);

      hydrated = true;

      const merged = mergeEvents(data, pending, workspaceId);

      setRows(merged);

      for (const event of pending) {
        if (event.kind !== "delete") {
          maybeToastFailed(event.row);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  const handleOptimisticRemove = useCallback((id: string): void => {
    setRows(current => {
      const row = current.find(candidate => {
        return candidate.id === id;
      });

      if (row !== undefined) {
        restoreBufferRef.current.set(id, row);
      }

      return current.filter(candidate => {
        return candidate.id !== id;
      });
    });
  }, []);

  const handleRestore = useCallback((id: string): void => {
    const row = restoreBufferRef.current.get(id);

    if (row === undefined) {
      return;
    }

    restoreBufferRef.current.delete(id);
    setRows(current => {
      return applyEvent(current, { kind: "insert", row }, row.workspace_id);
    });
  }, []);

  const handleDeleteConfirmed = useCallback((id: string): void => {
    restoreBufferRef.current.delete(id);
  }, []);

  const handleFiltersChange = useCallback((next: DashboardSearchParams): void => {
    setParams(next);
  }, []);

  const handleExport = useCallback(async (): Promise<void> => {
    setIsExporting(true);

    try {
      const response = await fetch(buildExportUrl(params), {
        method: "GET",
        credentials: "same-origin",
      });

      if (!response.ok) {
        // Race: the filtered set was non-empty when the user clicked but a concurrent
        // delete or status change wiped it before the request hit the DB. Handle 400
        // gracefully rather than pushing a zip with an error-JSON body onto the user.
        let errorCode: string | null = null;

        try {
          const body: unknown = await response.json();

          if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
            errorCode = body.error;
          }
        } catch {
          errorCode = null;
        }

        if (errorCode === "no_documents_match") {
          toast.error("No documents to export.");
        } else {
          toast.error("Export failed. Please try again.");
        }

        return;
      }

      const blob = await response.blob();
      const filename = parseAttachmentFilename(response.headers.get("content-disposition"));

      triggerDownload(blob, filename);
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }, [params]);

  const visibleRows = useMemo(() => {
    const filtered = filterByParams(rows, params);
    const query = params.q ?? "";

    return filtered.filter(row => {
      return matchesSearch(row, query);
    });
  }, [rows, params]);

  const totalCount = rows.length;
  const visibleCount = visibleRows.length;

  // R14a excludes needs_review (and pending/processing/failed) from export, so the
  // server always 400s for a filter view whose only rows are non-complete. Mirror
  // that on the client — disable the button rather than shipping a guaranteed
  // server rejection.
  const exportableCount = visibleRows.filter(row => {
    return row.status === "complete";
  }).length;

  const exportDisabledReason = exportableCount === 0 ? "No documents to export." : null;
  const isExportDisabled = exportDisabledReason !== null || isExporting;

  const exportButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isExportDisabled}
      aria-label="Export matching documents as a zip of CSVs"
    >
      <DownloadIcon />
      {isExporting ? "Exporting…" : "Export CSV"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <DashboardFilters value={params} onChange={handleFiltersChange} />
        </div>
        {exportDisabledReason === null ? (
          exportButton
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{exportButton}</span>
              </TooltipTrigger>
              <TooltipContent>{exportDisabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="w-[60px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-12 text-center">
                  {totalCount === 0
                    ? "No documents yet. Head to Upload to get started."
                    : "No documents match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map(row => {
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[320px] truncate">
                      <Link href={`/documents/${row.id}`} className="hover:underline" title={row.filename}>
                        {row.filename}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDocType(row.doc_type)}</TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(row.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <DeleteDocumentButton
                        id={row.id}
                        filename={row.filename}
                        onOptimisticRemove={handleOptimisticRemove}
                        onRestore={handleRestore}
                        onDeleteConfirmed={handleDeleteConfirmed}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-xs">
        {visibleCount} of {totalCount} documents
      </p>
    </div>
  );
};

export default DashboardTable;
