"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavLink = {
  href: string;
  label: string;
};

const NAV_LINKS: ReadonlyArray<NavLink> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
];

const isActive = (pathname: string, href: string): boolean => {
  if (pathname === href) {
    return true;
  }

  return pathname.startsWith(`${href}/`);
};

const TopNavLinks = (): React.ReactElement => {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
      {NAV_LINKS.map(link => {
        const active = isActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md border-b-2 px-2 py-1 transition-colors",
              active ? "border-brand text-foreground" : "text-muted-foreground hover:text-foreground border-transparent"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
};

export { isActive };
export default TopNavLinks;
