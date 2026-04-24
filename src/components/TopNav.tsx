import { signOutAction } from "@/app/actions/auth";
import Brand from "@/components/Brand";
import TopNavLinks from "@/components/TopNavLinks";
import { Button } from "@/components/ui/button";

type TopNavProps = {
  email: string | null;
};

const TopNav = ({ email }: TopNavProps): React.ReactElement => {
  return (
    <header className="flex items-center justify-between gap-4 border-b pb-3">
      <div className="flex items-center gap-6">
        <Brand size="md" />
        <TopNavLinks />
      </div>
      <div className="flex items-center gap-3">
        {email !== null ? <span className="text-muted-foreground hidden text-xs sm:inline">{email}</span> : null}
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
