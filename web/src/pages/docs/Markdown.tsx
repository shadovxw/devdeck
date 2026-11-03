import { Check, Copy } from "lucide-react";
import { isValidElement, useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router";
import remarkGfm from "remark-gfm";

import { pillSmall } from "../../design/pills";
import { docLink } from "../../lib/docs";

/** The text inside a node, for copying a code block. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A code block with a button that copies it: the prompts and commands in a guide are made to be pasted. */
function CodeBlock({ children }: Readonly<{ children?: ReactNode }>) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // Clipboard access can be refused; the text stays selectable either way.
    navigator.clipboard
      ?.writeText(textOf(children).replace(/\n$/, ""))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <div className="relative my-3">
      <button type="button" className={`${pillSmall} absolute end-2 top-2`} onClick={copy} aria-label={copied ? "Copied" : "Copy this block"}>
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="m-0 overflow-auto bg-inset p-4 pe-24 font-mono text-[12.5px] leading-5 text-ink">{children}</pre>
    </div>
  );
}

/** A guide, as text with the app's own look. Raw HTML in a guide is not rendered. */
export default function Markdown({ text, ids }: Readonly<{ text: string; ids: string[] }>) {
  return (
    <div className="max-w-3xl text-[14px] leading-6 text-ink-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="m-0 mb-3 text-[24px] font-semibold leading-8 text-ink">{children}</h2>,
          h2: ({ children }) => <h3 className="m-0 mb-2 mt-8 text-[18px] font-semibold text-ink">{children}</h3>,
          h3: ({ children }) => <h4 className="m-0 mb-1.5 mt-5 text-[15px] font-semibold text-ink">{children}</h4>,
          p: ({ children }) => <p className="m-0 my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 ps-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 ps-5">{children}</ol>,
          li: ({ children }) => <li className="my-1">{children}</li>,
          blockquote: ({ children }) => <blockquote className="m-0 my-3 bg-inset px-4 py-1 text-ink-2">{children}</blockquote>,
          hr: () => <hr className="my-6 h-px border-0 bg-line" />,
          strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ children, className }: ComponentProps<"code">) =>
            className ? <code className={className}>{children}</code> : <code className="bg-inset px-1 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="px-3 py-2 text-start text-[12.5px] font-medium text-ink-3">{children}</th>,
          td: ({ children }) => <td className="border-t border-line px-3 py-2 align-top">{children}</td>,
          a: ({ href, children }) => {
            const l = docLink(href, ids);
            if (l.kind === "doc") return <Link to={l.to} className="text-ink underline underline-offset-2">{children}</Link>;
            if (l.kind === "external") {
              return (
                <a href={l.href} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">
                  {children}
                </a>
              );
            }
            if (l.kind === "anchor") return <a href={l.href} className="text-ink underline underline-offset-2">{children}</a>;
            return <span>{children}</span>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

