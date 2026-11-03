/**
 * One application at a time per company, plus a cooldown between two applications to the same company, so an employer
 * never sees a burst from one agent. In-process (the worker runs the browser pool); the unique keys in the database guard
 * against duplicates across processes.
 */
export type GateRelease = () => void;

export class CompanyGate {
  private readonly state = new Map<string, { busy: boolean; freeAt: number; waiters: (() => void)[] }>();

  constructor(private readonly cooldownMs: number, private readonly now: () => number = Date.now) {}

  /** Resolves with a release function once this company is free and cooled down, or null after `maxWaitMs`. */
  async acquire(key: string, maxWaitMs: number): Promise<GateRelease | null> {
    const deadline = this.now() + maxWaitMs;
    const s = this.state.get(key) ?? { busy: false, freeAt: 0, waiters: [] };
    this.state.set(key, s);
    for (;;) {
      const t = this.now();
      if (!s.busy && t >= s.freeAt) {
        s.busy = true;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          s.busy = false;
          s.freeAt = this.now() + this.cooldownMs;
          for (const w of s.waiters.splice(0)) w();
        };
      }
      if (t >= deadline) return null;
      const wait = s.busy ? deadline - t : Math.min(s.freeAt, deadline) - t;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.max(1, wait));
        timer.unref?.();
        function done() { clearTimeout(timer); resolve(); }
        s.waiters.push(done);
      });
    }
  }

  /** Busy or cooling down right now. */
  blocked(key: string): boolean {
    const s = this.state.get(key);
    return !!s && (s.busy || this.now() < s.freeAt);
  }
}

/** Cooldown between two applications to one company: APPLY_COMPANY_COOLDOWN_MS, default 30 s. */
export function defaultCooldownMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.APPLY_COMPANY_COOLDOWN_MS ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

let shared: CompanyGate | null = null;
/** The process-wide gate the runner uses unless one is injected. */
export function sharedCompanyGate(): CompanyGate {
  return (shared ??= new CompanyGate(defaultCooldownMs()));
}
