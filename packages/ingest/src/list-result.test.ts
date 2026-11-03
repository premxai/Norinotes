import { describe, expect, it } from "vitest";
import { toListResult } from "./list-result.js";
import type { ListResult, NormalizedJob } from "./types.js";

const job = (id: string): NormalizedJob => ({
  atsType: "lever", externalId: id, companyName: "Acme", companyToken: "acme", title: "T", location: null, remote: false,
  descriptionText: "", applyUrl: "https://x.test", postedAt: null,
});

describe("toListResult", () => {
  it("turns a plain array into a complete read", () => {
    expect(toListResult([job("1"), job("2")])).toEqual({ jobs: [job("1"), job("2")], complete: true, notFound: false });
  });

  it("reads an empty array as a board that does not exist (the older connectors' convention)", () => {
    expect(toListResult([])).toEqual({ jobs: [], complete: true, notFound: true });
  });

  it("passes a ListResult through untouched", () => {
    const r: ListResult = { jobs: [job("1")], complete: false, etag: "\"x\"" };
    expect(toListResult(r)).toBe(r);
    const nm: ListResult = { jobs: [], complete: true, notModified: true, etag: "\"y\"" };
    expect(toListResult(nm)).toBe(nm);
  });
});
