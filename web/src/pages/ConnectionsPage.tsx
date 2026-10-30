import { ChevronRight, Container, Database, GitFork, ShieldCheck, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { PageHeader } from "../design/PageHeader";
import { useDocker } from "../lib/docker";
import { useGit } from "../lib/git";
import { stagger } from "../lib/motion";

type Kind = {
  name: string;
  icon: LucideIcon;
  text: string;
  /** Where its page is. Without it the kind isn't built yet. */
  to?: string;
  phase?: string;
};

const kinds: Kind[] = [
  { name: "GitHub", icon: GitFork, to: "/connections/github", text: "The accounts your repositories use: which one each repository belongs to, and the commit name and email." },
  { name: "Docker Hub", icon: Container, to: "/connections/docker", text: "The accounts images are pushed with, and the secrets a build asks for." },
  { name: "SonarQube", icon: ShieldCheck, phase: "Phase 8", text: "Quality and security reports for your projects." },
  { name: "Postgres", icon: Database, phase: "Phase 6", text: "Databases to browse, query and migrate." },
];

const card = "flex items-center gap-4 rounded-ctl bg-inset px-4 py-4 text-start";

/** What the GitHub card says about the current state. */
function githubStatus(git: ReturnType<typeof useGit>): string {
  if (git.isPending) return "Looking…";
  if (git.isError) return "Couldn’t be read";
  if (!git.data.gh_installed) return "The GitHub CLI isn’t installed yet";
  const n = git.data.connections.length;
  const a = git.data.accounts.length;
  return `${n} ${n === 1 ? "connection" : "connections"} · ${a} ${a === 1 ? "account" : "accounts"} signed in with gh`;
}

/** What the Docker Hub card says about the current state. */
function dockerStatus(docker: ReturnType<typeof useDocker>): string {
  if (docker.isPending) return "Looking…";
  if (docker.isError) return "Couldn’t be read";
  const n = docker.data.accounts.length;
  return `${n} ${n === 1 ? "account" : "accounts"}${docker.data.docker_installed ? "" : " · Docker isn’t installed"}`;
}

/** The accounts and services devdeck signs in to, one page for each kind. */
export function ConnectionsPage() {
  const item = navByPath("/connections");
  const git = useGit();
  const docker = useDocker();

  return (
    <>
      <PageHeader title={item.label} group={item.group} description="The accounts and services devdeck signs in to. Pick one to set it up." />
      <ul className="enter m-0 mt-4 grid list-none gap-3 p-0 md:grid-cols-2" style={stagger(1)}>
        {kinds.map((k) => {
          const Icon = k.icon;
          const body = (
            <>
              <Icon size={22} aria-hidden className={k.to ? "shrink-0 text-accent" : "shrink-0 text-ink-3"} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[16px] font-medium text-ink">{k.name}</span>
                <span className="text-[13px] text-ink-3">{k.text}</span>
                <span className="text-[13px] text-ink-2">{k.name === "GitHub" ? githubStatus(git) : k.name === "Docker Hub" ? dockerStatus(docker) : `Comes with ${k.phase}`}</span>
              </span>
              {k.to && <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-3" />}
            </>
          );
          return (
            <li key={k.name}>
              {k.to ? (
                <Link to={k.to} className={`${card} transition hover:bg-fill`}>
                  {body}
                </Link>
              ) : (
                <div aria-disabled="true" title={`Available in ${k.phase}`} className={`${card} opacity-60`}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
