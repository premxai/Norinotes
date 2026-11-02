/** Plain text from an HTML email body: links kept as "text (url)" so magic links survive the conversion. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return label && !label.includes(href) ? `${label} (${href})` : ` ${href} `;
    })
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** `Name <a@b.c>` or `a@b.c` to `{ name, address }` (address lower-cased). */
export function parseAddress(raw: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: (m[1] ?? "").trim(), address: (m[2] ?? "").trim().toLowerCase() };
  return { name: "", address: raw.trim().toLowerCase() };
}

/** Every address in a header-style list (`A <a@x>, b@y`). */
export function parseAddressList(raw: string): string[] {
  return raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => parseAddress(s).address).filter((a) => a.includes("@"));
}
