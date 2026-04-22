"use client";

import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DashboardSearchParams, DocTypeParam, StatusParam } from "@/lib/dashboard/live-feed";

type DashboardFiltersProps = {
  value: DashboardSearchParams;
  onChange: (next: DashboardSearchParams) => void;
};

const DOC_TYPE_OPTIONS: ReadonlyArray<{ value: DocTypeParam | "all"; label: string }> = [
  { value: "all", label: "All types" },
  { value: "w2", label: "W-2" },
  { value: "1099_nec", label: "1099-NEC" },
  { value: "1099_misc", label: "1099-MISC" },
  { value: "k1", label: "K-1" },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusParam | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "complete", label: "Complete" },
  { value: "needs_review", label: "Needs review" },
  { value: "failed", label: "Failed" },
];

const SEARCH_DEBOUNCE_MS = 200;

const buildHref = (params: DashboardSearchParams): string => {
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

  return query === "" ? "/dashboard" : `/dashboard?${query}`;
};

const isDocTypeOption = (raw: string): raw is DocTypeParam | "all" => {
  return raw === "all" || raw === "w2" || raw === "1099_nec" || raw === "1099_misc" || raw === "k1";
};

const isStatusOption = (raw: string): raw is StatusParam | "all" => {
  return (
    raw === "all" ||
    raw === "pending" ||
    raw === "processing" ||
    raw === "complete" ||
    raw === "needs_review" ||
    raw === "failed"
  );
};

const DashboardFilters = ({ value, onChange }: DashboardFiltersProps): React.ReactElement => {
  const router = useRouter();
  const [queryInput, setQueryInput] = useState(value.q ?? "");

  useEffect(() => {
    const trimmed = queryInput.trim();
    const normalized = trimmed === "" ? null : trimmed;

    if (normalized === value.q) {
      return;
    }

    const timer = window.setTimeout(() => {
      const next: DashboardSearchParams = { ...value, q: normalized };

      onChange(next);
      router.replace(buildHref(next), { scroll: false });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [queryInput, value, onChange, router]);

  const handleTypeChange = (raw: string): void => {
    if (!isDocTypeOption(raw)) {
      return;
    }

    const nextType = raw === "all" ? null : raw;
    const next: DashboardSearchParams = { ...value, type: nextType };

    onChange(next);
    router.replace(buildHref(next), { scroll: false });
  };

  const handleStatusChange = (raw: string): void => {
    if (!isStatusOption(raw)) {
      return;
    }

    const nextStatus = raw === "all" ? null : raw;
    const next: DashboardSearchParams = { ...value, status: nextStatus };

    onChange(next);
    router.replace(buildHref(next), { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Search filename, payer, employer, TIN…"
          value={queryInput}
          onChange={event => {
            setQueryInput(event.target.value);
          }}
          className="pl-9"
          aria-label="Search documents"
        />
      </div>

      <Select value={value.type ?? "all"} onValueChange={handleTypeChange}>
        <SelectTrigger aria-label="Filter by document type" className="min-w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DOC_TYPE_OPTIONS.map(option => {
            return (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Select value={value.status ?? "all"} onValueChange={handleStatusChange}>
        <SelectTrigger aria-label="Filter by status" className="min-w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map(option => {
            return (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};

export default DashboardFilters;
