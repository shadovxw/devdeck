import { Component, type ReactNode } from "react";
import { useRouteError } from "react-router";

import { ErrorView } from "../design/ErrorView";
import { PageHeader } from "../design/PageHeader";

/** A page crashed. The sidebar and top bar are still there, so the user can go elsewhere. */
export function PageError() {
  const error = useRouteError();
  return (
    <>
      <PageHeader title="Error" group="Workspace" />
      <ErrorView error={error} />
    </>
  );
}

/** The app shell itself crashed, so there is no sidebar to show: a full-window page. */
export function FatalError() {
  const error = useRouteError();
  return <ErrorView standalone error={error} />;
}

type State = { failed: boolean; error: unknown };

/**
 * Last line of defence, outside the router: catches a crash in the providers or
 * the loading screen, which the router's own error pages can't see.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  render() {
    if (this.state.failed) return <ErrorView standalone error={this.state.error} />;
    return this.props.children;
  }
}
