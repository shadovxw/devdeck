import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { stagger } from "../lib/motion";
import { Appearance } from "./appearance/Appearance";

/** The settings sections. Only Appearance exists so far; the others are listed so the page does not move when they arrive. */
const SECTIONS = [
  { id: "appearance", label: "Appearance", built: true },
  { id: "general", label: "General", built: false },
  { id: "terminal", label: "Terminal & editor", built: false },
  { id: "logs", label: "Logs", built: false },
  { id: "notifications", label: "Notifications", built: false },
  { id: "keyboard", label: "Keyboard", built: false },
  { id: "data", label: "Data & storage", built: false },
  { id: "about", label: "About", built: false },
];

const item = "flex h-[34px] items-center px-2.5 text-[13px]";

/** Settings: a list of sections at the left and the section at the right. */
export function SettingsPage() {
  const page = navByPath("/settings");
  return (
    <>
      <PageHeader title={page.label} group={page.group} />
      <div className="enter mt-10 grid items-start gap-x-10 gap-y-6 lg:grid-cols-[190px_minmax(0,1fr)]" style={stagger(1)}>
        <nav aria-label="Settings sections" className="lg:sticky lg:top-4">
          <ul className="m-0 flex list-none flex-col p-0">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                {s.built ? (
                  <a href={`#${s.id}`} aria-current="page" className={`${item} bg-fill font-medium text-ink shadow-[inset_2px_0_0_var(--selected)]`}>
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
        <section id="appearance" aria-label="Appearance" className="min-w-0">
          <h2 className="m-0 text-[20px] font-semibold leading-7 tracking-[-0.02em] text-ink">Appearance</h2>
          <p className="m-0 mb-8 mt-0.5 text-[13px] text-ink-3">How devdeck looks on this machine.</p>
          <Appearance />
        </section>
      </div>
    </>
  );
}
