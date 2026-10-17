import { Check, Copy, House, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { isRouteErrorResponse } from "react-router";

import { primaryButton, quietButton } from "./buttons";
import { EmptyArt } from "./EmptyArt";
import { Logo } from "./Logo";

export type ErrorInfo = { status?: number; message: string; stack?: string };

/** Turns whatever was thrown into something we can show. */
export function describeError(error: unknown): ErrorInfo {
  if (isRouteErrorResponse(error)) {
    const data = typeof error.data === "string" && error.data ? ` ${error.data}` : "";
    return { status: error.status, message: `${error.status} ${error.statusText}${data}`.trim() };
  }
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (typeof error === "string" && error) return { message: error };
  return { message: "Unknown error" };
}

function CopyDetails({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // clipboard blocked: the text is still selectable above
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-8 items-center gap-2 rounded-ctl px-2.5 text-[13px] text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-[.97]"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? "Copied" : "Copy details"}
    </button>
  );
}

type Props = {
  error?: unknown;
  /** Fills the whole window (used when the app shell itself failed). Otherwise it sits inside the page. */
  standalone?: boolean;
  title?: string;
  text?: string;
};

/**
 * What the user sees when something crashes: a clear headline, the two things
 * they can do next, and the technical details tucked away so they can be copied
 * into a bug report. Never a stack of raw text on a blank page.
 */
export function ErrorView({
  error,
  standalone = false,
  title = "Something went wrong",
  text = "This page hit an unexpected error. Reloading usually fixes it.",
}: Props) {
  const info = describeError(error);
  // The stack is only shown while developing; the message is always shown.
  const details = [info.message, import.meta.env.DEV ? info.stack : undefined].filter(Boolean).join("\n\n");
  const Heading = standalone ? "h1" : "h2";

  const content = (
    <section role="alert" className="flex w-full flex-col items-center px-2 pb-10 pt-4 text-center">
      {standalone && <Logo className="mb-4 size-10" />}
      <EmptyArt centerIcon={TriangleAlert} tone="critical" />
      {info.status && (
        <span className="mt-3 rounded-tag bg-fill px-2 py-0.5 font-mono text-[12px] text-ink-2">Error {info.status}</span>
      )}
      <Heading className="m-0 mt-3 text-[26px] font-bold leading-tight tracking-tight text-ink">{title}</Heading>
      <p className="m-0 mt-2.5 max-w-[56ch] text-[15px] leading-6 text-ink-3">{text}</p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
        <button type="button" onClick={() => window.location.reload()} className={primaryButton}>
          <RotateCw size={18} aria-hidden />
          Reload page
        </button>
        {/* A plain link on purpose: a full navigation also clears whatever state caused the crash. */}
        <a href="/" className={quietButton}>
          <House size={18} aria-hidden />
          Go to Home
        </a>
      </div>

      <details className="group mt-9 w-full max-w-[680px] text-start">
        <summary className="cursor-pointer list-none text-center text-[13px] text-ink-3 transition hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">Show technical details</span>
          <span className="hidden group-open:inline">Hide technical details</span>
        </summary>
        <div className="mt-3 rounded-sheet bg-inset p-3">
          <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink-2">{details}</pre>
          <div className="mt-2 flex justify-end">
            <CopyDetails text={details} />
          </div>
        </div>
      </details>
    </section>
  );

  if (!standalone) return content;
  return <main className="grid min-h-screen place-items-center bg-bg px-4 py-10 text-ink">{content}</main>;
}
