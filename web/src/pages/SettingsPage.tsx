import { useState, type ReactNode } from "react";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { Appearance } from "./appearance/Appearance";
import { About } from "./settings/About";
import { General } from "./settings/General";

/** The settings sections. Those not built yet are listed so the page does not move when they arrive. */
const SECTIONS = [
  { id: "appearance", label: "Appearance", built: true },
  { id: "general", label: "General", built: true },
  { id: "terminal", label: "Terminal & editor", built: false },
  { id: "logs", label: "Logs", built: false },
  { id: "notifications", label: "Notifications", built: false },
  { id: "keyboard", label: "Keyboard", built: false },
  { id: "data", label: "Data & storage", built: false },
  { id: "about", label: "About", built: true },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** What each built section shows: a title, one line under it, and its content. */
const CONTENT: Partial<Record<SectionId, { title: string; description: string; body: () => ReactNode }>> = {
  appearance: { title: "Appearance", description: "How devdeck looks on this machine.", body: () => <Appearance /> },
  general: { title: "General", description: "About you, on this machine.", body: () => <General /> },
  about: { title: "About", description: "This devdeck’s version, and whether a newer one is out.", body: () => <About /> },
};

const item = "flex h-[34px] items-center px-2.5 text-[13px]";

/** The section in the address (#about), or Appearance. */
function sectionFromHash(): SectionId {
  const id = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id && s.built) ? (id as SectionId) : "appearance";
}

/** Settings: a list of sections at the left and the section at the right. */
export function SettingsPage() {
  const page = navByPath("/settings");
  const [active, setActive] = useState<SectionId>(sectionFromHash);
  const content = CONTENT[active] ?? CONTENT.appearance!;
  return (
    <>
      <PageHeader title={page.label} group={page.group} />
      <div className="enter mt-10 grid items-start gap-x-10 gap-y-6 lg:grid-cols-[190px_minmax(0,1fr)]" style={stagger(1)}>
        <nav aria-label="Settings sections" className="lg:sticky lg:top-4">
          <ul className="m-0 flex list-none flex-col p-0">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                {s.built ? (
                  <a
                    href={`#${s.id}`}
                    aria-current={active === s.id ? "page" : undefined}
                    onClick={() => setActive(s.id)}
                    className={`${item} ${active === s.id ? "bg-fill font-medium text-ink shadow-[inset_2px_0_0_var(--selected)]" : "text-ink-2 hover:bg-fill hover:text-ink"}`}
                  >
                    {s.label}
                  </a>
                ) : (
                  <span aria-disabled="true" title="Comes in a later phase" className={`${item} cursor-default text-ink-3`}>
                    {s.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <section id={active} aria-label={content.title} className="min-w-0">
          <h2 className="m-0 text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink">{content.title}</h2>
          <p className="m-0 mb-8 mt-0.5 text-[13px] text-ink-3">{content.description}</p>
          {content.body()}
        </section>
      </div>
    </>
  );
}
