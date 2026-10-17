import { Terminal } from "lucide-react";

import type { NavItem } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";

// Stands in for a page that a later phase builds.
export function Placeholder({ item }: { item: NavItem }) {
  // The Home page's tile shows a terminal; every other page shows its own icon.
  const icon = item.path === "/" ? Terminal : item.icon;
  return (
    <>
      <PageHeader title={item.label} group={item.group} parent={item.parent} phase={item.phase} />
      {item.empty && <EmptyState icon={icon} empty={item.empty} phase={item.phase} />}
    </>
  );
}
