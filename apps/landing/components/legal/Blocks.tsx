import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalBlock } from "@/lib/legal";

/*
 * The text of the legal pages (legal pages spec sections 4 and 6). Inline Markdown becomes React nodes, never an HTML
 * string. Server components: nothing here ships to the browser.
 */

const TOKEN = /\[\[([\s\S]+?)\]\]|\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** Straight quotes to curly ones, in plain text only (never in code or addresses). */
const curl = (s: string) =>
  s
    .replace(/(\w)'/g, "$1’")
    .replace(/'(\w)/g, "‘$1")
    .replace(/"([^"]*)"/g, "“$1”");

const linkClass = "text-ink underline decoration-accent underline-offset-[3px] hover:decoration-2";

export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push(curl(text.slice(last, at)));
    const [, unsettled, bold, code, label, href, email] = m;
    const key = out.length;
    if (unsettled !== undefined)
      // Development only: a production build refuses the text before it gets here (lib/legal.ts).
      out.push(
        <mark key={key} className="rounded-[6px] border border-dashed border-[#D9A800] bg-[#FFF1B8] px-1 text-[#5A4500]">
          {unsettled}
        </mark>,
      );
    else if (bold !== undefined)
      out.push(
        <strong key={key} className="font-semibold">
          <Inline text={bold} />
        </strong>,
      );
    else if (code !== undefined)
      out.push(
        <code key={key} className="font-mono text-[0.88em]">
          {code}
        </code>,
      );
    else if (label !== undefined && href !== undefined)
      out.push(
        href.startsWith("https://") ? (
          <a key={key} href={href} className={linkClass}>
            {curl(label)}
          </a>
        ) : (
          <Link key={key} href={href} className={linkClass}>
            {curl(label)}
          </Link>
        ),
      );
    else if (email !== undefined)
      out.push(
        <a key={key} href={`mailto:${email}`} className={linkClass}>
          {email}
        </a>,
      );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(curl(text.slice(last)));
  return out;
}

/**
 * A table: a real table from 768 px (and in print), one card per row below that. Both are in the HTML; the one not
 * shown is hidden at that width (legal pages spec section 4).
 */
function Table({ head, rows, caption }: { head: string[]; rows: string[][]; caption: string }) {
  return (
    <>
      <div role="region" aria-label={caption} tabIndex={0} className="legal-table overflow-x-auto rounded-card border-[1.5px] border-line bg-surface max-tablet:hidden">
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="border-b border-line bg-surface-2 px-3.5 py-2.5 text-left align-top font-mono text-label font-medium text-ink-2">
                  <Inline text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-b-0">
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-3.5 py-2.5 text-left align-top font-normal">
                      <Inline text={c} />
                    </th>
                  ) : (
                    <td key={j} className="px-3.5 py-2.5 align-top">
                      <Inline text={c} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="legal-cards flex flex-col gap-2.5 tablet:hidden">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-col gap-1.5 rounded-card border-[1.5px] border-line bg-surface px-3.5 py-3 text-[0.9375rem] leading-[1.5]">
            <p>
              <Inline text={r[0]!} />
            </p>
            {r.slice(1).map((c, j) => (
              <p key={j}>
                <span className="block font-mono text-label text-ink-2">{head[j + 1]}</span>
                <Inline text={c} />
              </p>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Blocks({ blocks, caption }: { blocks: LegalBlock[]; caption: string }) {
  return blocks.map((b, i) =>
    b.kind === "p" ? (
      <p key={i}>
        <Inline text={b.text} />
      </p>
    ) : b.kind === "list" ? (
      <ul key={i} className="flex list-disc flex-col gap-2 pl-[22px]">
        {b.items.map((t, j) => (
          <li key={j}>
            <Inline text={t} />
          </li>
        ))}
      </ul>
    ) : (
      <Table key={i} head={b.head} rows={b.rows} caption={caption} />
    ),
  );
}
