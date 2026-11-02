import { describe, expect, it } from "vitest";
import { extractResumeText, htmlToText, SCANNED_PDF_ERROR } from "./extract.js";
import { makeDocx, makePdf } from "./testkit.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("extractResumeText", () => {
  it("reads a PDF text layer in line order", async () => {
    const bytes = makePdf(["Priya Raman", "Senior Software Engineer | Acme Cloud | Jan 2021 - Present", "Built a Kafka pipeline for 2M users"]);
    const r = await extractResumeText({ name: "resume.pdf", mime: "application/pdf", bytes });
    expect(r.error).toBeUndefined();
    expect(r.pages).toBe(1);
    expect(r.text.split("\n").map((l) => l.trim())).toEqual([
      "Priya Raman", "Senior Software Engineer | Acme Cloud | Jan 2021 - Present", "Built a Kafka pipeline for 2M users",
    ]);
  });

  it("does not detach the caller's buffer", async () => {
    const bytes = makePdf(["Hello there world, this is a resume line"]);
    await extractResumeText({ name: "a.pdf", mime: "application/pdf", bytes });
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("flags a PDF with no text layer instead of returning an empty resume silently", async () => {
    const r = await extractResumeText({ name: "scan.pdf", mime: "application/pdf", bytes: makePdf([]) });
    expect(r.text).toBe("");
    expect(r.error).toBe(SCANNED_PDF_ERROR);
  });

  it("reads a DOCX, turning list items into bullets", async () => {
    const bytes = makeDocx(["Priya Raman", "EXPERIENCE", "Acme Cloud | Jan 2021 - Present", "• Led a team of 5 engineers", "• Cut deploy time by 60%"]);
    const r = await extractResumeText({ name: "resume.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes });
    expect(r.text).toBe("Priya Raman\nEXPERIENCE\nAcme Cloud | Jan 2021 - Present\n• Led a team of 5 engineers\n• Cut deploy time by 60%");
  });

  it("passes plain text through, normalising line endings and ligatures", async () => {
    const r = await extractResumeText({ name: "cv.txt", mime: "text/plain", bytes: enc("Jane Doe\r\n\r\n\r\n\r\nofﬁce  \r\n") });
    expect(r.text).toBe("Jane Doe\n\noffice");
  });

  it("turns Markdown into plain lines and collects link targets", async () => {
    const md = "# Jane Doe\n\n- Built [Nori](https://github.com/jane/nori) with **TypeScript**\n";
    const r = await extractResumeText({ name: "cv.md", mime: "text/markdown", bytes: enc(md) });
    expect(r.text).toBe("Jane Doe\n\n• Built Nori with TypeScript");
    expect(r.links).toEqual([{ url: "https://github.com/jane/nori", anchor: "Nori" }]);
  });

  it("falls back to sniffing the bytes when the MIME type is generic", async () => {
    const r = await extractResumeText({ name: "upload", mime: "application/octet-stream", bytes: makePdf(["Sniffed resume line with enough text"]) });
    expect(r.text).toContain("Sniffed resume line");
  });

  it("flattens HTML tables and collects hyperlinks from DOCX output", () => {
    const links: { url: string; anchor?: string }[] = [];
    const text = htmlToText('<p><a href="https://github.com/jane">GitHub</a></p><table><tr><td>Acme</td><td>2020 &amp; 2021</td></tr></table>', links);
    expect(text).toContain("GitHub");
    expect(text).toContain("Acme | 2020 & 2021");
    expect(links).toEqual([{ url: "https://github.com/jane", anchor: "GitHub" }]);
  });
});
