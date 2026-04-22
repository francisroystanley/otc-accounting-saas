import { redirect } from "next/navigation";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const DashboardPage = async (): Promise<React.ReactElement> => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <h1 className="text-2xl font-semibold">Dashboard coming soon</h1>
      <p className="text-muted-foreground text-sm">Your uploaded documents will appear here.</p>
    </div>
  );
};

export default DashboardPage;
