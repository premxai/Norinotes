import type { Connector } from "../types.js";

/**
 * Workday: not implemented yet.
 *
 * Public endpoint shape (no login): every tenant exposes a JSON "CXS" API next to its careers site,
 * `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with body
 * `{ "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }`, which pages through `jobPostings`
 * (`title`, `externalPath`, `locationsText`, `postedOn`) and reports `total`. One posting's full HTML description is
 * `GET .../wday/cxs/{tenant}/{site}{externalPath}` (`jobPostingInfo.jobDescription`, `.startDate`, `.externalUrl`).
 * A board token needs three parts (tenant, datacentre number `wdN`, site), so the token format will be
 * `tenant|wdN|site`. Page size is capped at 20 and requests must send a JSON content type.
 */
export const workday: Connector = {
  atsType: "workday",
  async listJobs() { throw new Error("not implemented: Workday connector"); },
  async fetchJob() { throw new Error("not implemented: Workday connector"); },
  parseUrl() { return null; },
};

/**
 * Oracle Recruiting Cloud (Oracle HCM candidate experience): not implemented yet.
 *
 * Public endpoint shape (no login): `GET https://{host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
 * with `finder=findReqs;siteNumber={CX_n},limit=25,offset=0,sortBy=POSTING_DATES_DESC` and `expand=requisitionList`
 * returns `items[0].requisitionList[]` (`Id`, `Title`, `PrimaryLocation`, `PostedDate`). One requisition's description is
 * `.../recruitingCEJobRequisitionDetails?finder=ById;Id="{id}",siteNumber={CX_n}` (`ExternalDescriptionStr`). The board
 * token will need the host, region and site number, for example `host|region|CX_1`.
 */
export const oracle: Connector = {
  atsType: "oracle",
  async listJobs() { throw new Error("not implemented: Oracle connector"); },
  async fetchJob() { throw new Error("not implemented: Oracle connector"); },
  parseUrl() { return null; },
};
