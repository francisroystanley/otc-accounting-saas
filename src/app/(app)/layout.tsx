import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import DemoBanner from "@/components/DemoBanner";
import TopNav from "@/components/TopNav";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const AppLayout = async ({ children }: { children: ReactNode }): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8">
      <DemoBanner />
      <TopNav email={auth.email} />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="text-muted-foreground mt-4 flex items-center justify-between border-t pt-5 text-xs">
        <span className="inline-flex items-center gap-2 font-medium">
          <span aria-hidden="true" className="bg-brand size-1.5 rounded-[2px]" />
          OTC Accounting
        </span>
        <span>Prototype &middot; synthetic PDFs only</span>
      </footer>
    </div>
  );
};

export default AppLayout;
