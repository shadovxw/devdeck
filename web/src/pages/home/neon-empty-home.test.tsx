import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Empty } from "../../app/nav";
import { useUi } from "../../store/ui";
import { NeonEmptyHome } from "./NeonEmptyHome";

vi.mock("../../design/orb/OrbCanvas", () => ({ default: () => <canvas data-testid="orb-canvas" /> }));

afterEach(() => {
  cleanup();
  useUi.setState({ look: "paper", effects: null });
});

const empty: Empty = {
  headline: "Your workspace is ready to connect",
  text: "Start a stack to bring your services, logs, and resources into one view.",
  secondary: { label: "View setup guide", href: "https://example.com/guide" },
};

function renderEmpty(hasWorkspace: boolean) {
  render(
    <MemoryRouter>
      <NeonEmptyHome hasWorkspace={hasWorkspace} empty={empty} />
    </MemoryRouter>,
  );
}

describe("Neon Home with nothing running", () => {
  it("without a workspace: the hero, its orb state, one action and the guide", () => {
    useUi.setState({ look: "neon", effects: null });
    renderEmpty(false);
    const hero = screen.getByRole("region", { name: "Get started" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your workspace is ready to connect.");
    expect(hero.querySelector('[data-ui="gradient-word"]')!.textContent).toBe("to connect");
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Configure workspace/ }).getAttribute("href")).toBe("/workspaces");
    expect(screen.getByRole("link", { name: /Setup guide/ }).getAttribute("href")).toBe("https://example.com/guide");
    expect(screen.getByText("devdeck help")).toBeTruthy();
    // The test browser has no WebGL, so the hero shows the usual art where the orb would be.
    expect(hero.querySelector('[data-ui="orb"]')).toBeNull();
    expect(hero.querySelector("svg[aria-hidden]")).toBeTruthy();
  });

  it("with a workspace: one quiet line and a small action, no orb", () => {
    useUi.setState({ look: "neon", effects: null });
    const { container } = render(
      <MemoryRouter>
        <NeonEmptyHome hasWorkspace empty={empty} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No stacks running/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open stacks/ }).getAttribute("href")).toBe("/stacks");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector('[data-ui="orb"]')).toBeNull();
  });
});
