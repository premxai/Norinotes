import { applications, careerPoints, companies, jobSpecs, jobs, profiles, shortlist, users, type Db } from "@norinote/db";
import type { CareerPoint, FitMapEntry, JobSpec } from "@norinote/shared";

/** Test-only builders. Not exported from the package. */

export const SPEC: JobSpec = {
  mustHaves: ["Build REST APIs in TypeScript", "PostgreSQL experience"],
  niceToHaves: ["Kubernetes", "Redis caching"],
  skills: [
    { name: "TypeScript", level: "advanced", years: 3, required: true },
    { name: "PostgreSQL", level: "working", years: 2, required: true },
    { name: "Kubernetes", level: "working", years: null, required: false },
    { name: "Docker", level: "working", years: null, required: false },
    { name: "Redis", level: "working", years: null, required: false },
  ],
  seniority: "mid", roleFamily: "software engineering", yearsMin: 3,
  location: { remote: "remote", countries: ["US"], cities: [] },
  citizenshipRequired: false, clearanceRequired: false, sponsorship: "unknown", responsibilities: ["Build APIs"],
};

type PointSeed = Omit<CareerPoint, "id"> & { id?: string };
const point = (p: Partial<PointSeed> & Pick<PointSeed, "kind" | "title">): PointSeed => ({
  org: null, startDate: null, endDate: null, text: "", skills: [], scope: {}, metrics: {}, sourceQuote: null, ...p,
});

export const POINT_SEEDS = {
  acme: point({
    kind: "role", title: "Backend Engineer", org: "Acme", startDate: "2021-03", endDate: null,
    text: "Built REST APIs in TypeScript serving 2M requests per day\nMigrated the billing service to PostgreSQL, cutting query time by 40%\nWrote onboarding docs for new engineers",
    skills: ["TypeScript", "PostgreSQL", "REST"],
  }),
  redis: point({ kind: "achievement", title: "Caching", org: "Acme", startDate: "2022-06", text: "Reduced p95 latency from 800ms to 200ms by adding Redis caching", skills: ["Redis"], metrics: { p95Before: "800ms", p95After: "200ms" } }),
  globex: point({ kind: "role", title: "Software Engineer Intern", org: "Globex", startDate: "2020-06", endDate: "2020-09", text: "Built internal dashboards in React for the support team", skills: ["React"] }),
  cafe: point({ kind: "role", title: "Barista", org: "Cafe", startDate: "2018-05", endDate: "2019-08", text: "Served customers and managed the till during busy shifts" }),
  router: point({ kind: "project", title: "Pocket Router", text: "Built a Rust load balancer that handled 10000 connections in benchmarks", skills: ["Rust"] }),
  recipes: point({ kind: "project", title: "Recipe App", text: "Built a recipe sharing app with a friend over a weekend", skills: ["Flutter"] }),
  school: point({ kind: "education", title: "BS Computer Science", org: "State University", startDate: "2017", endDate: "2021" }),
  docker: point({ kind: "skill", title: "Docker" }),
} as const;

export type World = {
  userId: string;
  jobId: string;
  companyId: string;
  pointIds: Record<keyof typeof POINT_SEEDS, string>;
  points: CareerPoint[];
  fitMap: FitMapEntry[];
};

/** A user with a profile and career points, a job with a spec, and a shortlist row with a fit map. */
export async function seedWorld(db: Db, tag: string, opts: { withShortlist?: boolean; withApplication?: boolean } = {}): Promise<World> {
  const [user] = await db.insert(users).values({ email: `${tag}@example.test`, passwordHash: "x" }).returning();
  const userId = user!.id;
  await db.insert(profiles).values({
    userId, contact: { name: "Ada Lovelace", phone: "+1 555 0100", linkedin: "linkedin.com/in/ada", github: "github.com/ada" }, location: "Austin, TX",
  });
  const [company] = await db.insert(companies).values({ atsType: "greenhouse", atsToken: `co-${tag}`, name: "Initech" }).returning();
  const [job] = await db.insert(jobs).values({
    companyId: company!.id, atsType: "greenhouse", externalId: `job-${tag}`, title: "Backend Engineer", applyUrl: `https://example.test/${tag}`, dedupeKey: `initech|backend|${tag}`,
  }).returning();
  const jobId = job!.id;
  await db.insert(jobSpecs).values({ jobId, version: 1, spec: SPEC, model: "test" });

  const pointIds = {} as Record<keyof typeof POINT_SEEDS, string>;
  const points: CareerPoint[] = [];
  for (const [key, seed] of Object.entries(POINT_SEEDS) as [keyof typeof POINT_SEEDS, PointSeed][]) {
    const [row] = await db.insert(careerPoints).values({
      userId, kind: seed.kind, title: seed.title, org: seed.org, startDate: seed.startDate, endDate: seed.endDate, text: seed.text,
      skills: seed.skills, scope: seed.scope, metrics: seed.metrics, sourceQuote: seed.sourceQuote,
    }).returning();
    pointIds[key] = row!.id;
    points.push({ ...seed, id: row!.id });
  }
  const fitMap: FitMapEntry[] = [
    { requirement: "Build REST APIs in TypeScript", mustHave: true, score: 0.9, careerPointIds: [pointIds.acme] },
    { requirement: "PostgreSQL experience", mustHave: true, score: 0.8, careerPointIds: [pointIds.acme] },
    { requirement: "Redis caching", mustHave: false, score: 0.7, careerPointIds: [pointIds.redis] },
    { requirement: "Dashboards in React", mustHave: false, score: 0.4, careerPointIds: [pointIds.globex] },
    { requirement: "Kubernetes", mustHave: false, score: 0, careerPointIds: [] },
  ];
  if (opts.withShortlist !== false) await db.insert(shortlist).values({ userId, jobId, fit: 0.8, fitMap, reasons: [] });
  if (opts.withApplication) await db.insert(applications).values({ userId, jobId, status: "queued" });
  return { userId, jobId, companyId: company!.id, pointIds, points, fitMap };
}

/** A fake PDF that carries a page count the way a real one does, sized by how many bullets the document has. */
export function fakePdfRenderer(bulletsPerPage: (html: string) => number = () => 12) {
  const calls: { bullets: number; html: string }[] = [];
  const renderer = async (html: string): Promise<Buffer> => {
    const bullets = (html.match(/<li>/g) ?? []).length;
    calls.push({ bullets, html });
    const compact = /font-size: 10.1pt/.test(html) ? 1.15 : /font-size: 9.65pt/.test(html) ? 1.3 : 1;
    const pages = Math.max(1, Math.ceil(bullets / (bulletsPerPage(html) * compact)));
    return Buffer.from(Array.from({ length: pages }, () => "<< /Type /Page >>").join("\n") + "\n<< /Type /Pages /Count " + pages + " >>");
  };
  return { renderer, calls };
}
