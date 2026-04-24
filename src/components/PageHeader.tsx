import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

const PageHeader = ({ title, description, eyebrow, actions, className }: PageHeaderProps): React.ReactElement => {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {eyebrow !== undefined ? (
        <span className="text-brand text-[11px] font-semibold tracking-[0.16em] uppercase">{eyebrow}</span>
      ) : null}
      <div className="flex items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
          {description !== undefined ? <p className="text-muted-foreground max-w-2xl text-sm">{description}</p> : null}
        </div>
        {actions !== undefined ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
};

export default PageHeader;
