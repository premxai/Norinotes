import { decodeEntities } from "../html.js";

/**
 * A small non-validating XML reader for the RSS (Teamtailor) and `workzag-jobs` (Personio) feeds, so no dependency is
 * needed. Handles elements, attributes, CDATA, comments, processing instructions, DOCTYPE and entity decoding.
 * Prefixed names (`tt:location`) are kept as written. Malformed or truncated input throws, so a half-read feed is
 * never taken for a complete one. Written for this repo.
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Direct text and CDATA of this element, concatenated, untrimmed. */
  text: string;
};

export class XmlParseError extends Error {
  constructor(message: string) { super(message); this.name = "XmlParseError"; }
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(ATTR)) attrs[m[1] as string] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

/** Parse a document and return its root element. */
export function parseXml(xml: string): XmlNode {
  const src = xml.replace(/^\uFEFF/, "");
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let pos = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    if (m.index !== pos) throw new XmlParseError(`unexpected "<" at offset ${pos}`);
    pos = TOKEN.lastIndex;
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { if (top) top.text += m[1]; continue; }
    if (m[6] !== undefined) { if (top) top.text += decodeEntities(m[6]); else if (m[6].trim()) throw new XmlParseError("text outside the root element"); continue; }
    if (m[2] !== undefined) {
      if (!top || top.name !== m[2]) throw new XmlParseError(`unexpected closing tag </${m[2]}>`);
      stack.pop();
      continue;
    }
    if (m[3] !== undefined) {
      const node: XmlNode = { name: m[3], attrs: parseAttrs(m[4] ?? ""), children: [], text: "" };
      if (top) top.children.push(node);
      else if (root) throw new XmlParseError("more than one root element");
      else root = node;
      if (m[5] !== "/") stack.push(node);
    }
    // comments, processing instructions and DOCTYPE fall through and are dropped
  }
  if (pos !== src.length) throw new XmlParseError(`unexpected "<" at offset ${pos}`);
  if (stack.length) throw new XmlParseError(`unclosed element <${stack[stack.length - 1]?.name}>`);
  if (!root) throw new XmlParseError("no root element");
  return root;
}

/** Every direct child element with this name. */
export const childrenOf = (node: XmlNode, name: string): XmlNode[] => node.children.filter((c) => c.name === name);

/** First direct child element with this name. */
export const childOf = (node: XmlNode, name: string): XmlNode | null => node.children.find((c) => c.name === name) ?? null;

/** Trimmed text of the first direct child with this name, or null when absent or blank. */
export function textOf(node: XmlNode, name: string): string | null {
  const t = childOf(node, name)?.text.trim();
  return t ? t : null;
}

/** Every descendant element with this name (depth first). */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
