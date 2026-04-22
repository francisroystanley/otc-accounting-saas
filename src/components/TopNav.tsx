import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

type TopNavProps = {
  email: string | null;
};

const TopNav = ({ email }: TopNavProps): React.ReactElement => {
  return (
    <header className="flex items-center justify-between gap-4 border-b pb-3">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          OTC Accounting
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/upload" className="text-muted-foreground hover:text-foreground">
            Upload
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        {email !== null ? <span className="text-muted-foreground text-xs">{email}</span> : null}
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
};

export default TopNav;
