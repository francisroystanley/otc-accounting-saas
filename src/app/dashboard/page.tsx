import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { getAuthenticatedContext } from "@/lib/auth/require-auth";

const DashboardPage = async () => {
  const auth = await getAuthenticatedContext();

  if (auth === null) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Dashboard coming soon</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Signed in as user <span className="font-mono text-xs">{auth.userId}</span> — workspace{" "}
          <span className="font-mono text-xs">{auth.workspaceId}</span>
        </p>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
};

export default DashboardPage;
