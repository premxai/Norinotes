import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJobPostingJsonLd, parseJobPostingsJsonLd } from "./jsonld.js";

const fx = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-02T12:00:00Z");

describe("parseJobPostingJsonLd", () => {
  it("reads an iCIMS detail page (one block, a list of places, HTML description)", () => {
    const page = "https://careers-peraton.icims.com/jobs/173137/senior-watch-officer/job?in_iframe=1";
    const j = parseJobPostingJsonLd(fx("icims-detail.html"), page, NOW);
    expect(j).toMatchObject({
      title: "Senior Watch Officer (SWO) / Active Secret",
      // "UNAVAILABLE" street and postal code are placeholders iCIMS writes; they never reach the location.
      location: "Washington, DC, US",
      remote: false,
      closed: false,
      companyName: "Peraton",
      employmentType: "FULL_TIME",
      department: "Intel and Threat Analysis",
      applyUrl: "https://careers-peraton.icims.com/jobs/173137/senior-watch-officer-%28swo%29---active-secret/job",
    });
    expect(j?.postedAt?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(j?.validThrough?.toISOString()).toBe("2027-11-02T04:00:00.000Z");
    expect(j?.descriptionText.startsWith("Peraton Overview\n\nPeraton is a next-generation national security company")).toBe(true);
    expect(j?.descriptionText).not.toMatch(/<[a-z]/);
  });

  it("skips the WebSite block on a Breezy page and reads TELECOMMUTE as remote", () => {
    const page = "https://1001.breezy.hr/p/77078545d414-android-developer";
    const j = parseJobPostingJsonLd(fx("breezy-detail.html"), page, NOW);
    expect(j).toMatchObject({
      title: "Android Developer", location: "Baghdad/Erbil, IQ", remote: true, closed: false, companyName: "1001",
      employmentType: "FULL_TIME", validThrough: null,
      applyUrl: "https://1001.breezy.hr/p/77078545d414-android-developer?source=GoogleJobs",
    });
    expect(j?.postedAt?.toISOString()).toBe("2023-08-06T00:00:00.000Z");
    expect(j?.descriptionText).toMatch(/^1001 is seeking a skilled and dedicated Mid-Level Android Developer/);
  });

  it("walks @graph, joins several locations once each, and reads an escaped description", () => {
    const all = parseJobPostingsJsonLd(fx("jsonld-graph.html"), "https://careers.example.com/jobs/9001", NOW);
    expect(all).toHaveLength(2);
    const [graph] = all;
    expect(graph).toMatchObject({
      title: "Senior Data Engineer", location: "Berlin, DE | Dublin, Leinster, Ireland", remote: false, closed: false,
      companyName: "Example Co", employmentType: "FULL_TIME", identifier: "REQ-9001",
      applyUrl: "https://careers.example.com/jobs/9001/apply",
    });
    expect(graph?.descriptionText).toBe("Build the pipelines that feed our models.\n\n- Python & SQL\n- Airflow");
    expect(graph?.postedAt?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    // a bare validThrough date keeps the whole day open
    expect(parseJobPostingJsonLd(fx("jsonld-graph.html"), "x", new Date("2026-12-31T23:00:00Z"))?.closed).toBe(false);
    expect(parseJobPostingJsonLd(fx("jsonld-graph.html"), "x", new Date("2027-01-01T01:00:00Z"))?.closed).toBe(true);
  });

  it("treats a past validThrough as closed, TELECOMMUTE as remote, and tolerates raw control characters", () => {
    const second = parseJobPostingsJsonLd(fx("jsonld-graph.html"), "https://careers.example.com/jobs/9002", NOW)[1];
    expect(second).toMatchObject({
      title: "Remote Support Engineer", closed: true, remote: true, location: "Remote (USA, Canada)", companyName: "Example Co",
      applyUrl: "https://careers.example.com/jobs/9002",
    });
    expect(second?.descriptionText).toBe("Help customers. Second line with a raw tab and newline inside the string.");
    expect(second?.validThrough?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("returns null when there is no JobPosting, and ignores broken blocks", () => {
    expect(parseJobPostingJsonLd("<html><body>nothing</body></html>", "x")).toBeNull();
    expect(parseJobPostingJsonLd('<script type="application/ld+json">{not json</script>', "x")).toBeNull();
    expect(parseJobPostingJsonLd('<script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>', "x")).toBeNull();
    const ok = parseJobPostingJsonLd(`<script type='application/ld+json'>[{"@type":"JobPosting","name":"Chef","jobLocation":"Paris, France"}]</script>`, "https://x.test/1");
    expect(ok).toMatchObject({ title: "Chef", location: "Paris, France", applyUrl: "https://x.test/1", descriptionText: "" });
  });
});
