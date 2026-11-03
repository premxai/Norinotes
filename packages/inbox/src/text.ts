/** Query parameters that only exist to track the reader. Removed from stored links; everything else is kept. */
const TRACKING_PARAMS = /^(utm_[a-z]+|mc_eid|mc_cid|_hsenc|_hsmi|hsCtaTracking|mkt_tok|gclid|fbclid|msclkid|oly_enc_id|oly_anon_id|vero_id|__s|ss_source|trk|trkInfo|ref_src)$/i;
/** Hosts and paths of open-tracking pixels and beacons. */
const TRACKER_SRC = /\/(open|pixel|track|beacon|o)\.(gif|png)|\/wf\/open|\/e\/o\/|\/trk\/|open\.aspx|pixel|beacon|track(ing)?[./]|list-manage\.com\/track|mandrillapp\.com\/track|sendgrid\.net\/wf|mailchimp|hubspot.*\/e2t|mktoresp|\.mjt\.lu\/oo|\/emimp\//i;

/** Removes tracking query parameters from a URL. Invalid URLs come back unchanged. */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) { u.searchParams.delete(key); changed = true; }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};

/** An `<img>` that only tells the sender the mail was opened: 0 or 1 pixel, hidden, or served by a known tracker. */
export function isTrackingPixel(imgTag: string): boolean {
  const w = attr(imgTag, "width");
  const h = attr(imgTag, "height");
  const style = (attr(imgTag, "style") ?? "").toLowerCase().replace(/\s+/g, "");
  const src = attr(imgTag, "src") ?? "";
  if ((w !== null && /^[01](px)?$/i.test(w.trim())) || (h !== null && /^[01](px)?$/i.test(h.trim()))) return true;
  if (/display:none|visibility:hidden|(width|height):[01]px|max-height:0|opacity:0/.test(style)) return true;
  return TRACKER_SRC.test(src);
}

/**
 * HTML with the parts that phone home or run removed: scripts, styles, forms, iframes, tracking pixels, and every remote
 * image (an image fetch is itself a read receipt). Links stay, without tracking parameters. Used before the HTML is turned
 * into text; the HTML itself is not stored.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|iframe|object|embed|link|meta|base)\b[^>]*>/gi, " ")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      if (isTrackingPixel(tag)) return " ";
      const alt = attr(tag, "alt");
      return alt ? ` ${alt} ` : " ";
    })
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href\s*=\s*["'])([^"']+)(["'])/gi, (_m, a: string, href: string, b: string) => `${a}${stripTrackingParams(href.replace(/&amp;/g, "&"))}${b}`);
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", zwnj: "", zwj: "", shy: "" };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Plain text from an HTML email body, after `sanitizeHtml`: links kept as "text (url)" so magic links survive the
 * conversion, block elements become line breaks, zero-width preheader padding is dropped.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    sanitizeHtml(html)
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
        const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return label && !label.includes(href) ? `${label} (${href})` : ` ${href} `;
      })
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>|<\/table>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]|\u034F/g, "")
    .replace(/[ \t\u00A0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
