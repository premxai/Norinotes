import { describe, expect, it } from "vitest";
import { childOf, childrenOf, descendants, parseXml, textOf, XmlParseError } from "./xml.js";

describe("parseXml", () => {
  it("reads elements, attributes, CDATA, entities and prefixed names", () => {
    const root = parseXml(`<?xml version="1.0"?>
      <!DOCTYPE feed>
      <!-- comment -->
      <rss version="2.0" xmlns:tt="https://teamtailor.com/locations">
        <channel>
          <item><title>A &amp; B &#233; &lt;3</title><description><![CDATA[<p>Hi &amp; bye</p>]]></description>
            <tt:locations><tt:location><tt:city>Oslo</tt:city></tt:location></tt:locations><empty/><flag on='yes' /></item>
          <item><title>Second</title></item>
        </channel>
      </rss>`);
    expect(root.name).toBe("rss");
    expect(root.attrs["version"]).toBe("2.0");
    const items = descendants(root, "item");
    expect(items).toHaveLength(2);
    expect(textOf(items[0]!, "title")).toBe("A & B é <3");
    expect(textOf(items[0]!, "description")).toBe("<p>Hi &amp; bye</p>");
    expect(textOf(descendants(root, "tt:location")[0]!, "tt:city")).toBe("Oslo");
    expect(textOf(items[0]!, "empty")).toBeNull();
    expect(childOf(items[0]!, "flag")?.attrs["on"]).toBe("yes");
    expect(childrenOf(childOf(root, "channel")!, "item")).toHaveLength(2);
  });

  it("throws on truncated, mismatched and non-XML input", () => {
    expect(() => parseXml("<rss><channel><item>")).toThrow(XmlParseError);
    expect(() => parseXml("<a><b></a></b>")).toThrow(/closing tag/);
    expect(() => parseXml("<a>1 < 2</a>")).toThrow(XmlParseError);
    expect(() => parseXml("just text")).toThrow(XmlParseError);
    expect(() => parseXml("")).toThrow(/no root/);
    expect(() => parseXml("<a/><b/>")).toThrow(/more than one root/);
  });
});
