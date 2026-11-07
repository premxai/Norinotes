import { randomBytes } from "node:crypto";
import { eq, inboxAddresses, profiles, sql, type Db } from "@norinote/db";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A random local part like `nori-k3x9q2mhd4`: 10 characters from an alphabet without look-alikes, about 49 bits. */
function randomLocalPart(): string {
  let out = "";
  for (const b of randomBytes(10)) out += ALPHABET[b % ALPHABET.length];
  return `nori-${out}`;
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string }; message?: string } | null;
  return e?.code === "23505" || e?.cause?.code === "23505" || /unique|duplicate key/i.test(String(e?.message ?? ""));
};

const existingFor = async (db: Db, userId: string): Promise<string | null> => {
  const [row] = await db.select({ address: inboxAddresses.address }).from(inboxAddresses)
    .where(eq(inboxAddresses.userId, userId)).orderBy(inboxAddresses.createdAt).limit(1);
  return row?.address ?? null;
};

/**
 * The user's inbound address on `domain`: created on first call, the same afterwards ("stable"). The local part is
 * random so addresses cannot be guessed or enumerated; uniqueness is enforced by the database and retried on a clash.
 */
export async function assignInboxAddress(db: Db, userId: string, domain: string): Promise<string> {
  const host = domain.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw new Error(`Invalid inbound email domain: ${domain}`);
  const existing = await existingFor(db, userId);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const address = `${randomLocalPart()}@${host}`;
    try {
      // One transaction per user at a time, so two calls at once cannot give the same user two addresses.
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inbox-address:${userId}`}))`);
        const again = await existingFor(tx as unknown as Db, userId);
        if (again) return again;
        await tx.insert(inboxAddresses).values({ userId, address });
        return address;
      });
    } catch (err) {
      // A clash on the random address: try another.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Could not allocate a unique inbox address");
}

/** The user's address if one was assigned, without creating one. */
export async function getInboxAddress(db: Db, userId: string): Promise<string | null> {
  return existingFor(db, userId);
}

// ---- settings: forwarding and retention, kept in profiles.preferences.inbox (no extra table) --------------------------

/** Default days a message is kept before the retention job deletes it. */
export const DEFAULT_RETENTION_DAYS = 90;

export type InboxSettings = {
  /** Forward each message (except spam) to this address. Null: show in Norinote only. */
  forwardTo: string | null;
  forwardEnabled: boolean;
  /** Days a message is kept, 1 to 365. Null: the deployment default (`INBOX_RETENTION_DAYS`, 90). */
  retentionDays: number | null;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const recOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The user's inbox settings. Forwarding is off until they turn it on: applications carry their own email, so employers
 * already write to their real inbox, and the Norinote address mostly receives the codes they chose to send it.
 */
export function readInboxSettings(preferences: unknown): InboxSettings {
  const o = recOf(recOf(preferences).inbox);
  const forwardTo = typeof o.forwardTo === "string" && EMAIL.test(o.forwardTo) ? o.forwardTo.toLowerCase() : null;
  const days = typeof o.retentionDays === "number" && Number.isInteger(o.retentionDays) && o.retentionDays >= 1 && o.retentionDays <= 365 ? o.retentionDays : null;
  return { forwardTo, forwardEnabled: o.forwardEnabled === true && forwardTo !== null, retentionDays: days };
}

export async function getInboxSettings(db: Db, userId: string): Promise<InboxSettings> {
  const [row] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return readInboxSettings(row?.preferences);
}

/**
 * Updates the inbox settings (only the fields given). A forwarding address must look like an email and must not be one of
 * our own inbound addresses (a loop). Throws `Error` with a user-facing message on bad input.
 */
export async function updateInboxSettings(db: Db, userId: string, patch: Partial<InboxSettings>, opts: { inboundDomain?: string } = {}): Promise<InboxSettings> {
  const current = await getInboxSettings(db, userId);
  const next: InboxSettings = { ...current };
  if (patch.forwardTo !== undefined) {
    const to = patch.forwardTo?.trim().toLowerCase() || null;
    if (to && !EMAIL.test(to)) throw new Error("Forwarding address is not a valid email address");
    if (to && opts.inboundDomain && to.endsWith(`@${opts.inboundDomain.toLowerCase()}`)) throw new Error("Forwarding address cannot be a Norinote inbox address");
    next.forwardTo = to;
  }
  if (patch.forwardEnabled !== undefined) next.forwardEnabled = patch.forwardEnabled;
  if (patch.retentionDays !== undefined) {
    const d = patch.retentionDays;
    if (d !== null && !(Number.isInteger(d) && d >= 1 && d <= 365)) throw new Error("Retention must be between 1 and 365 days");
    next.retentionDays = d;
  }
  if (!next.forwardTo) next.forwardEnabled = false;
  const value = { forwardTo: next.forwardTo, forwardEnabled: next.forwardEnabled, retentionDays: next.retentionDays };
  await db.insert(profiles).values({ userId, preferences: { inbox: value } })
    .onConflictDoUpdate({ target: profiles.userId, set: { preferences: sql`coalesce(${profiles.preferences}, '{}'::jsonb) || jsonb_build_object('inbox', ${JSON.stringify(value)}::jsonb)` } });
  return next;
}
