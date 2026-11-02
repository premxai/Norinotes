const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', bull: "•", middot: "·",
  copy: "(c)", reg: "(R)", trade: "(TM)", eacute: "é", egrave: "è", agrave: "à", uuml: "ü", ouml: "ö", auml: "ä",
};

/** Decode named and numeric HTML entities. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Escaped HTML (Greenhouse ships entity-escaped markup) to real HTML. Plain HTML passes through unchanged. */
export function unescapeHtml(s: string): string {
  return /&lt;\/?[a-z]/i.test(s) && !/<[a-z!/][^>]*>/i.test(s) ? decodeEntities(s) : s;
}

/**
 * Strip HTML to clean plain text. Block tags become line breaks, list items become "- " bullets, scripts, styles and
 * comments are dropped, entities are decoded and whitespace is tidied.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = unescapeHtml(html);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|table|section|article|header|footer|blockquote)\s*>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|ul|ol|tr|table|section|article|blockquote)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, " ");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    // <li> and </li> both break the line, which leaves a blank line between bullets; keep a list tight.
    .replace(/^(- .*)\n\n(?=- )/gm, "$1\n")
    .trim();
}
