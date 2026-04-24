import type { ReactNode } from "react";
import Brand from "@/components/Brand";

const AuthLayout = ({ children }: { children: ReactNode }): React.ReactElement => {
  return (
    <div className="bg-background flex min-h-screen flex-1 flex-col items-center justify-center gap-8 px-6 py-12">
      <Brand asLink={false} size="lg" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground text-xs">
        Synthetic IRS samples only &middot; do not upload real tax documents
      </p>
    </div>
  );
};

export default AuthLayout;
