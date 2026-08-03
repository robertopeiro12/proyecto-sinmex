"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navSections } from "./nav-config";
import { cn } from "@/lib/utils";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4">
      {navSections.map((section) => (
        <div key={section.label}>
          <p className="px-3 text-xs font-semibold uppercase text-muted-foreground">
            {section.label}
          </p>
          <ul className="mt-1 flex flex-col">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm hover:bg-accent",
                    pathname === item.href && "bg-accent font-medium",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
