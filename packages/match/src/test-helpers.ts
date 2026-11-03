import { fakeEmbedding } from "@norinote/ai";
import {
  careerPointEmbeddings, careerPoints, companies, jobEmbeddings, jobSpecs, jobs, lanes, profiles, users, type Db,
} from "@norinote/db";
import { SPEC_VERSION, type StoredJobSpec } from "./understand.js";
import { parseWorkAuth, type MatchProfile } from "./profile.js";

export const NOW = new Date("2026-10-31T12:00:00Z");
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function seedUser(db: Db, opts: { workAuth?: Record<string, unknown>; location?: string } = {}): Promise<string> {
  const [u] = await db.insert(users).values({ email: `u${uniq()}@example.test`, passwordHash: "x" }).returning();
  await db.insert(profiles).values({ userId: u!.id, workAuth: opts.workAuth ?? {}, location: opts.location ?? null });
  return u!.id;
}

export async function seedCompany(db: Db, opts: { name?: string; blocked?: boolean } = {}): Promise<string> {
  const [c] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `co${uniq()}`, name: opts.name ?? "Acme", blocked: opts.blocked ?? false }).returning();
  return c!.id;
}

export function baseSpec(over: Partial<StoredJobSpec> = {}): StoredJobSpec {
  return {
    mustHaves: [], niceToHaves: [], skills: [], seniority: "mid", roleFamily: "backend engineering", yearsMin: null,
    location: { remote: "unknown", countries: [], cities: [] },
    citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: [], requirementWeights: {},
    ...over,
  };
}

export type SeedJob = {
  companyId: string;
  title?: string;
  location?: string | null;
  remote?: boolean;
  description?: string;
  postedAt?: Date | null;
  firstSeenAt?: Date;
  closedAt?: Date | null;
  /** Writes a spec for the job when given. */
  spec?: StoredJobSpec;
  /** Writes `fakeEmbedding(embedText)` as the job embedding when given. */
  embedText?: string;
};

/**
 * A neutral posting body (no skills, no restrictions) long enough to count as a real description. Jobs seeded with a spec
 * get it unless the test passes its own `description`: a spec read from a real posting is a well-specified job.
 */
export const NEUTRAL_DESCRIPTION = Array.from({ length: 8 }, () =>
  "You will join a friendly team, plan your own work with the people around you, ship improvements every week and help us keep a high bar for quality.",
).join(" ");

export async function seedJob(db: Db, o: SeedJob): Promise<string> {
  const id = uniq();
  const [j] = await db.insert(jobs).values({
    companyId: o.companyId, atsType: "greenhouse", externalId: id, title: o.title ?? "Software Engineer",
    location: o.location === undefined ? "San Francisco, CA" : o.location, remote: o.remote ?? false,
    descriptionText: o.description ?? (o.spec ? NEUTRAL_DESCRIPTION : ""), applyUrl: `https://example.test/jobs/${id}`,
    postedAt: o.postedAt === undefined ? daysAgo(3) : o.postedAt, firstSeenAt: o.firstSeenAt ?? daysAgo(3),
    closedAt: o.closedAt ?? null, dedupeKey: id,
  }).returning();
  if (o.spec) await db.insert(jobSpecs).values({ jobId: j!.id, version: SPEC_VERSION, spec: o.spec, model: "test" });
  if (o.embedText) await db.insert(jobEmbeddings).values({ jobId: j!.id, embedding: fakeEmbedding(o.embedText), model: "test" });
  return j!.id;
}

export async function seedLane(db: Db, userId: string, o: Partial<{ name: string; titles: string[]; locations: string[]; remote: boolean; minFit: number; enabled: boolean }> = {}): Promise<string> {
  const [l] = await db.insert(lanes).values({
    userId, name: o.name ?? "Engineering", titles: o.titles ?? ["Software Engineer"], locations: o.locations ?? ["San Francisco, CA"],
    remote: o.remote ?? false, minFit: o.minFit ?? 0.5, enabled: o.enabled ?? true,
  }).returning();
  return l!.id;
}

export async function seedPoint(db: Db, userId: string, o: {
  kind?: "role" | "project" | "achievement" | "education" | "skill"; title: string; org?: string | null; start?: string | null; end?: string | null;
  text?: string; skills?: string[]; scope?: Record<string, unknown>; metrics?: Record<string, unknown>; embed?: boolean;
}): Promise<string> {
  const [p] = await db.insert(careerPoints).values({
    userId, kind: o.kind ?? "role", title: o.title, org: o.org ?? null, startDate: o.start ?? null, endDate: o.end ?? null,
    text: o.text ?? "", skills: o.skills ?? [], scope: o.scope ?? {}, metrics: o.metrics ?? {},
  }).returning();
  if (o.embed !== false) {
    await db.insert(careerPointEmbeddings).values({ careerPointId: p!.id, userId, embedding: fakeEmbedding(`${o.title} ${o.text ?? ""} ${(o.skills ?? []).join(" ")}`), model: "test" });
  }
  return p!.id;
}

/** A `MatchProfile` for pure tests. */
export function profileOf(over: Partial<Omit<MatchProfile, "workAuth">> & { workAuth?: Record<string, unknown> } = {}): MatchProfile {
  const { workAuth, ...rest } = over;
  return {
    userId: "u", location: null, workAuth: parseWorkAuth(workAuth ?? {}), lanes: [], experienceYears: null, points: [], ...rest,
  };
}
