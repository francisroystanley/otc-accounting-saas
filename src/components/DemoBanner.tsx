const DemoBanner = (): React.ReactElement => {
  return (
    <div className="bg-card text-card-foreground relative flex items-center gap-3 overflow-hidden rounded-md border py-2 pr-3 pl-4 text-sm">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-amber-500 dark:bg-amber-400" />
      <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700 uppercase ring-1 ring-amber-500/30 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30">
        Demo
      </span>
      <span className="text-muted-foreground">
        Synthetic IRS sample PDFs only &mdash; do not upload real tax documents.
      </span>
    </div>
  );
};

export default DemoBanner;
