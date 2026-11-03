import { companies, eq, jobs } from "@norinote/db";
import type { Db } from "@norinote/db";
import { getConnector } from "./connectors/index.js";
import type { HttpOptions } from "./types.js";

/** Job systems whose list feed has no description text; every other system's list already carries it. */
const LIST_WITHOUT_TEXT: ReadonlySet<string> = new Set(["workday", "oracle"]);

export type FillDescriptionResult = "filled" | "has_text" | "unsupported" | "gone" | "missing";

/**
 * Some list feeds (Workday) carry no description. When such a job matters (it fits somebody's lane and is about to be
 * understood), read the single posting and store its text. Does nothing when the job already has a description or the
 * job system cannot read one posting. Failures of the feed throw, so the caller decides whether to go on without text.
 */
export async function fillJobDescription(db: Db, jobId: string, http: HttpOptions = {}): Promise<FillDescriptionResult> {
  const [row] = await db.select({
    id: jobs.id, atsType: jobs.atsType, externalId: jobs.externalId, text: jobs.descriptionText, token: companies.atsToken,
  }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, jobId)).limit(1);
  if (!row) return "missing";
  if (row.text.trim()) return "has_text";
  if (!LIST_WITHOUT_TEXT.has(row.atsType)) return "unsupported";
  const connector = getConnector(row.atsType);
  if (connector.ready === false || !connector.fetchJob) return "unsupported";
  const detail = await connector.fetchJob(row.token, row.externalId, http);
  if (!detail) return "gone";
  const text = detail.descriptionText.replaceAll("\u0000", "");
  if (!text.trim()) return "unsupported";
  await db.update(jobs).set({ descriptionText: text }).where(eq(jobs.id, jobId));
  return "filled";
}
