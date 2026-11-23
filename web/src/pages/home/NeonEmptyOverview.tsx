import { Boxes, Layers } from "lucide-react";
import { Link } from "react-router";

import { quietButton } from "../../design/buttons";
import { stagger } from "../../lib/motion";

/**
 * Overview with nothing running: the quiet kind of empty, one mono line and a
 * small action. Without a workspace it points to Workspaces, where the hero empty state is.
 */
export function NeonEmptyOverview({ hasWorkspace }: Readonly<{ hasWorkspace: boolean }>) {
  const [line, to, label, Icon] = hasWorkspace
    ? ["No stacks running · start one to see it here", "/stacks", "Open stacks", Layers] as const
    : ["No workspace yet · add one to start", "/workspaces", "Open workspaces", Boxes] as const;
  return (
    <div data-ui="quiet-empty" className="enter flex flex-wrap items-center gap-x-6 gap-y-3 py-16" style={stagger(1)}>
      <p data-ui="quiet-line" className="m-0">
        {line}
      </p>
      <Link to={to} viewTransition className={quietButton}>
        <Icon size={16} aria-hidden />
        {label}
      </Link>
    </div>
  );
}
