/**
 * Postgres LISTEN/NOTIFY on one channel, through one dedicated connection per process. A notification is delivered to
 * the listeners connected at that moment and is never written to a table, so it suits data that must not be stored.
 */
import pg from "pg";

export type NotifyChannel = {
  publish(payload: string): Promise<void>;
  /** Start receiving; `onPayload` gets every notification on the channel from now on. */
  listen(onPayload: (payload: string) => void): Promise<void>;
  close(): Promise<void>;
};

export function createNotifyChannel(connectionString: string, channel: string): NotifyChannel {
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error("channel must be a plain lower-case identifier");
  const handlers = new Set<(payload: string) => void>();
  let client: Promise<pg.Client> | null = null;
  const connect = () => (client ??= (async () => {
    const c = new pg.Client({ connectionString, keepAlive: true });
    const reset = () => { client = null; };
    c.on("error", reset);
    c.on("end", reset);
    c.on("notification", (msg) => {
      if (msg.channel !== channel || !msg.payload) return;
      for (const fn of handlers) fn(msg.payload);
    });
    await c.connect();
    // Every connection this process opens listens once anyone here listens, so a reconnect keeps listening.
    if (handlers.size) await c.query(`listen ${channel}`);
    return c;
  })().catch((err) => { client = null; throw err; }));
  return {
    async publish(payload) {
      await (await connect()).query("select pg_notify($1, $2)", [channel, payload]);
    },
    async listen(onPayload) {
      const first = handlers.size === 0;
      handlers.add(onPayload);
      const c = await connect();
      if (first) await c.query(`listen ${channel}`);
    },
    async close() {
      const c = client;
      client = null;
      handlers.clear();
      if (c) await (await c.catch(() => null))?.end().catch(() => {});
    },
  };
}
