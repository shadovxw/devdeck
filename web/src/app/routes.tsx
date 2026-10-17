import { Compass, House } from "lucide-react";
import type { ReactElement } from "react";
import type { RouteObject } from "react-router";

import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { Placeholder } from "../pages/Placeholder";
import { PluginsPage } from "../pages/PluginsPage";
import { NAV_ITEMS } from "./nav";
import { Shell } from "./Shell";

// Pages that are built. Every other nav entry gets a placeholder until its phase.
const built: Record<string, ReactElement> = {
  "/plugins": <PluginsPage />,
};

function NotFound() {
  return (
    <>
      <PageHeader title="Not found" group="Workspace" />
      <EmptyState
        icon={Compass}
        empty={{
          headline: "This page doesn't exist",
          text: "The address may be mistyped, or the page has moved.",
          cta: { label: "Back to Home", icon: House, to: "/" },
        }}
      />
    </>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      ...NAV_ITEMS.map((item) => ({
        path: item.path,
        element: built[item.path] ?? <Placeholder item={item} />,
      })),
      { path: "*", element: <NotFound /> },
    ],
  },
];
