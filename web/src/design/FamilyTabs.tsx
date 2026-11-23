import { NavLink, useLocation } from "react-router";

import { familyOf } from "../app/nav";
import { cn } from "@/lib/utils";
import { tabClass } from "./Tabs";

/**
 * The tabs of a page's family (nav.ts FAMILIES): Stacks · Logs · Resources · Images and tags.
 * The sidebar lists only the family's first page; these tabs reach the rest. A page that isn't
 * built yet is a dimmed tab that says which phase brings it. Nothing for a page with no family.
 */
export function FamilyTabs() {
  const { pathname } = useLocation();
  const family = familyOf(pathname);
  if (!family) return null;
  return (
    <nav data-ui="family-tabs" aria-label={`${family[0].label} pages`} className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
      {family.map((item) => {
        const label = item.tab ?? item.label;
        if (!item.built) {
          return (
            <span key={item.path} aria-disabled="true" title={`Comes in ${item.phase}`} className={cn(tabClass(false), "cursor-default opacity-50 hover:text-ink-3")}>
              {label}
            </span>
          );
        }
        const selected = pathname === item.path;
        return (
          <NavLink key={item.path} to={item.path} end viewTransition aria-current={selected ? "page" : undefined} className={tabClass(selected)}>
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}
