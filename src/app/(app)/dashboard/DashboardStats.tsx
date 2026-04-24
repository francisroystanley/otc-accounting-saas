import type { DocumentRow } from "@/lib/dashboard/live-feed";
import { cn } from "@/lib/utils";

type DashboardStatsProps = {
  rows: ReadonlyArray<DocumentRow>;
};

type Status = DocumentRow["status"];

type StatDef = {
  status: Status;
  label: string;
  /** Tailwind classes for the status dot. Pulled into a variant map so the
   * dashboard reads as a single visual scale; no two dots invent a new color. */
  dotClass: string;
};

const STATS: ReadonlyArray<StatDef> = [
  { status: "pending", label: "Pending", dotClass: "bg-muted-foreground/40" },
  { status: "processing", label: "Processing", dotClass: "bg-foreground/60 animate-pulse" },
  { status: "complete", label: "Complete", dotClass: "bg-brand" },
  { status: "needs_review", label: "Needs review", dotClass: "bg-amber-500" },
  { status: "failed", label: "Failed", dotClass: "bg-destructive" },
];

const countByStatus = (rows: ReadonlyArray<DocumentRow>, status: Status): number => {
  let n = 0;

  for (const row of rows) {
    if (row.status === status) {
      n += 1;
    }
  }

  return n;
};

const DashboardStats = ({ rows }: DashboardStatsProps): React.ReactElement => {
  const total = rows.length;

  return (
    <dl
      aria-label="Document status summary"
      className="bg-card divide-border grid grid-cols-2 divide-y overflow-hidden rounded-xl border sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-6"
    >
      <div className="flex flex-col gap-2 px-5 py-4">
        <dt className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">Total</dt>
        <dd className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{total}</dd>
      </div>
      {STATS.map(stat => {
        const count = countByStatus(rows, stat.status);

        return (
          <div key={stat.status} className="flex flex-col gap-2 px-5 py-4">
            <dt className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase">
              <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full", stat.dotClass)} />
              {stat.label}
            </dt>
            <dd
              className={cn(
                "text-2xl font-semibold tracking-[-0.02em] tabular-nums",
                count === 0 && "text-muted-foreground/40"
              )}
            >
              {count}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export default DashboardStats;
