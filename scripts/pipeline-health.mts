/**
 * Read-only health check of the job pipeline, against the database in .env.production: are boards being read, are fresh
 * jobs coming in, are they read by the AI (not the rule-based fallback) and embedded, is the queue moving, and does each
 * person have jobs to see. Writes nothing.
 *
 *   npx tsx scripts/pipeline-health.mts
 *
 * Reads DATABASE_URL_POOLER (or DATABASE_URL) from the environment or .env.production; ENGINE_ATS from the environment
 * (default "greenhouse").
 */
import { existsSync, readFileSync } from "node:fs";
import { connect, sql } from "@norinote/db";

const fileEnv: Record<string, string> = existsSync(".env.production")
  ? Object.fromEntries(readFileSync(".env.production", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
  : {};
const env = (name: string) => process.env[name]?.trim() || fileEnv[name];
const url = env("DATABASE_URL_POOLER") || env("DATABASE_URL");
if (!url) { console.error("Needs DATABASE_URL_POOLER (or DATABASE_URL)."); process.exit(2); }
const engine = (process.env.ENGINE_ATS ?? "greenhouse").split(",").map((s) => s.trim()).filter(Boolean);

const handle = await connect({ url });
const { db } = handle;
const rows = async (q: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> => {
  const r = (await db.execute(q)) as unknown as { rows?: Record<string, unknown>[] } & Record<string, unknown>[];
  return r.rows ?? r;
};
const show = (title: string, r: Record<string, unknown>[]) => { console.log(`\n## ${title}`); console.table(r); };

const FRESH = sql`coalesce(j.posted_at, j.first_seen_at) >= now() - interval '72 hours'`;
const HOSTED = sql`(j.ats_type <> 'greenhouse' OR j.apply_url ~* '^https?://(job-boards|boards)(\\.eu)?\\.greenhouse\\.io/')`;
const ENGINE = engine.length ? sql`j.ats_type = ANY(string_to_array(${engine.join(",")}, ',')) AND ${HOSTED}` : sql`true`;

try {
  show("Boards (companies) by system and status", await rows(sql`
    SELECT ats_type, status, count(*)::int AS boards,
      count(*) FILTER (WHERE last_polled_at > now() - interval '1 hour')::int AS read_1h,
      count(*) FILTER (WHERE last_polled_at > now() - interval '24 hours')::int AS read_24h,
      count(*) FILTER (WHERE error_streak > 0)::int AS erroring,
      count(*) FILTER (WHERE next_poll_at < now() - interval '1 hour')::int AS overdue_1h
    FROM companies WHERE blocked = false GROUP BY 1, 2 ORDER BY 1, 2`));

  show("Fresh open jobs (72 h) by system", await rows(sql`
    SELECT j.ats_type, count(*)::int AS fresh,
      count(*) FILTER (WHERE ${HOSTED})::int AS fillable_form,
      count(*) FILTER (WHERE j.first_seen_at > now() - interval '1 hour')::int AS new_1h,
      count(*) FILTER (WHERE j.first_seen_at > now() - interval '24 hours')::int AS new_24h,
      max(j.first_seen_at) AS newest_seen
    FROM jobs j WHERE j.closed_at IS NULL AND ${FRESH} GROUP BY 1 ORDER BY 2 DESC`));

  show(`Reading of fresh engine jobs (${engine.join(",") || "all"})`, await rows(sql`
    SELECT count(*)::int AS jobs,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM job_specs s WHERE s.job_id = j.id AND s.version >= 1))::int AS ai_read,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM job_specs s WHERE s.job_id = j.id AND s.version >= 1)
                         AND EXISTS (SELECT 1 FROM job_specs s WHERE s.job_id = j.id))::int AS rule_based_only,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM job_specs s WHERE s.job_id = j.id))::int AS unread,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM job_embeddings e WHERE e.job_id = j.id))::int AS embedded,
      count(*) FILTER (WHERE j.description_text = '')::int AS no_description
    FROM jobs j WHERE j.closed_at IS NULL AND ${FRESH} AND ${ENGINE}`));

  show("Job specs written in the last 24 h, by model", await rows(sql`
    SELECT model, version, count(*)::int AS specs, max(created_at) AS latest FROM job_specs
    WHERE created_at > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 3 DESC`));

  show("Queue (pg-boss) in the last 6 h", await rows(sql`
    SELECT name, state, count(*)::int AS jobs FROM pgboss.job
    WHERE created_on > now() - interval '6 hours' GROUP BY 1, 2 ORDER BY 1, 2`));

  show("People: what each one can see", await rows(sql`
    SELECT left(u.id::text, 8) AS user_id, split_part(u.email, '@', 2) AS email_domain,
      coalesce(p.preferences->'onboarding'->>'step', '-') AS onboarding,
      (SELECT count(*) FROM lanes l WHERE l.user_id = u.id AND l.enabled)::int AS roles,
      (SELECT count(*) FROM career_points c WHERE c.user_id = u.id)::int AS graph_facts,
      (SELECT count(*) FROM shortlist s JOIN jobs j ON j.id = s.job_id
        WHERE s.user_id = u.id AND s.status = 'new' AND j.closed_at IS NULL AND ${FRESH} AND ${ENGINE})::int AS matches_shown,
      (SELECT max(s.created_at) FROM shortlist s WHERE s.user_id = u.id) AS last_match,
      (SELECT count(*) FROM applications a WHERE a.user_id = u.id)::int AS applications
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.created_at`));
} finally {
  await handle.close();
}
