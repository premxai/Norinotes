import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, unescapeHtml } from "./html.js";

describe("htmlToText", () => {
  it("turns blocks into lines and list items into bullets", () => {
    expect(htmlToText("<h2>Role</h2><p>Build <b>things</b>.</p><ul><li>Go</li><li>SQL</li></ul>")).toBe("Role\n\nBuild things.\n\n- Go\n- SQL");
  });

  it("decodes entity-escaped markup (Greenhouse) and entities", () => {
    expect(htmlToText("&lt;p&gt;R&amp;amp;D &amp;mdash; caf&amp;eacute;&lt;/p&gt;")).toBe("R&D - café");
    expect(unescapeHtml("<p>already html</p>")).toBe("<p>already html</p>");
    expect(decodeEntities("&#65;&#x42;&nbsp;&unknown;")).toBe("AB &unknown;");
  });

  it("drops scripts, styles and comments and tidies whitespace", () => {
    expect(htmlToText("<style>p{}</style><!-- x --><script>alert(1)</script><p>  a \t b  </p>\n\n\n\n<p>c</p>")).toBe("a b\n\nc");
  });

  it("is empty for empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
