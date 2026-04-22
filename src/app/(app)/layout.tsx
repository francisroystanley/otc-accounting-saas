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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <DemoBanner />
      <TopNav email={auth.email} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
};

export default AppLayout;
