import { randomBytes } from "node:crypto";
import { eq, inboxAddresses, sql, type Db } from "@norinote/db";

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
