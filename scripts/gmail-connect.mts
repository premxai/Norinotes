/**
 * Connects a Norinote account's Gmail through Composio, without the dashboard: prints the link to open, then waits until
 * the connection is active. While an application run waits for an emailed code, the worker then reads that Gmail for it.
 *
 *   npx tsx scripts/gmail-connect.mts --email you@example.com            connect (or reconnect)
 *   npx tsx scripts/gmail-connect.mts --email you@example.com --status   show the connection
 *   npx tsx scripts/gmail-connect.mts --email you@example.com --test     list the code mail Gmail returns right now
 *
 * Reads DATABASE_URL (or DATABASE_URL_POOLER) and COMPOSIO_API_KEY from the environment or .env.production.
 */
import { existsSync, readFileSync } from "node:fs";
import { connect, eq, users } from "@norinote/db";
import { codeQuery, createComposioGmail, getGmailConnection, saveGmailConnection } from "@norinote/inbox";

const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const fileEnv: Record<string, string> = existsSync(".env.production")
  ? Object.fromEntries(readFileSync(".env.production", "utf8").split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]))
  : {};
const env = (name: string) => process.env[name]?.trim() || fileEnv[name];

const email = value("email")?.trim().toLowerCase();
const apiKey = env("COMPOSIO_API_KEY");
const url = env("DATABASE_URL_POOLER") || env("DATABASE_URL");
if (!email || !apiKey || !url) {
  console.error("Needs --email, COMPOSIO_API_KEY and DATABASE_URL (or DATABASE_URL_POOLER).");
  process.exit(2);
}

const handle = await connect({ url });
try {
  const [user] = await handle.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No Norinote account for ${email}`);
  const gmail = createComposioGmail({ apiKey });
  const current = await getGmailConnection(handle.db, user.id);

  if (args.includes("--status")) {
    console.log(current ? `${current.connectedAccountId}: ${await gmail.status(current.connectedAccountId)}` : "not connected");
  } else if (args.includes("--test")) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const mail = await gmail.fetch(user.id, codeQuery(since), 5);
    console.log(`${mail.length} code-like message(s) in the last day`);
    for (const m of mail) console.log(`- ${m.receivedAt?.toISOString() ?? "?"}  ${m.from}  |  ${m.subject}`);
  } else {
    const link = await gmail.connect(user.id);
    if (link.connectedAccountId) await saveGmailConnection(handle.db, user.id, { connectedAccountId: link.connectedAccountId, startedAt: new Date().toISOString(), activeAt: null });
    console.log(`Open this link and approve Gmail access:\n\n  ${link.url}\n`);
    if (!link.connectedAccountId) { console.log("(Composio did not say which connection this is; run --status after approving.)"); }
    else {
      process.stdout.write("Waiting for the approval");
      for (let i = 0; i < 60; i++) {
        const s = await gmail.status(link.connectedAccountId);
        if (s === "ACTIVE") {
          await saveGmailConnection(handle.db, user.id, { connectedAccountId: link.connectedAccountId, startedAt: new Date().toISOString(), activeAt: new Date().toISOString() });
          console.log("\nConnected. Nori reads this Gmail for codes while an application waits for one.");
          break;
        }
        if (["FAILED", "EXPIRED", "REVOKED"].includes(s)) { console.log(`\nThe connection ended as ${s}. Run this again.`); break; }
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
} finally {
  await handle.close();
}
