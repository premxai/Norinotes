/**
 * One application at a time per company, plus a cooldown between two applications to the same company, so an employer
 * never sees a burst from one agent. Built with a database (`companyGateFor`) the lease lives in `apply_locks`, so
 * every worker machine obeys it; without one (tests, the embedded single-process setup) it is kept in memory.
 */
import type { Db } from "@norinote/db";
import { acquireLock, companyLockKey } from "./locks.js";

export type GateRelease = () => Promise<void>;

/** How long a claim on a company lasts without a release: apply.run's 20-minute lease, plus a margin. */
export const COMPANY_LEASE_MS = 25 * 60_000;
/** How often a waiting run asks for a company another machine holds. */
const RETRY_MS = 1000;

export class CompanyGate {
  private readonly state = new Map<string, { busy: boolean; freeAt: number; waiters: (() => void)[] }>();

  constructor(
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
    /** Present in the worker: the claim is shared by every process. */
    private readonly db?: Db,
    private readonly leaseMs: number = COMPANY_LEASE_MS,
  ) {}

  /** Resolves with a release function once this company is free and cooled down, or null after `maxWaitMs`. */
  async acquire(key: string, maxWaitMs: number): Promise<GateRelease | null> {
    if (this.db) return this.acquireShared(key, maxWaitMs);
    return this.acquireLocal(key, maxWaitMs);
  }

  /** Busy or cooling down right now, as far as this process knows. */
  blocked(key: string): boolean {
    const s = this.state.get(key);
    return !!s && (s.busy || this.now() < s.freeAt);
  }

  private async acquireShared(key: string, maxWaitMs: number): Promise<GateRelease | null> {
    const deadline = this.now() + maxWaitMs;
    const lock = companyLockKey(key);
    for (;;) {
      const release = await acquireLock(this.db!, lock, { now: () => new Date(this.now()), holdMs: this.leaseMs, cooldownMs: this.cooldownMs });
      if (release) return release;
      if (this.now() + RETRY_MS >= deadline) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, RETRY_MS);
        timer.unref?.();
      });
    }
  }

  private async acquireLocal(key: string, maxWaitMs: number): Promise<GateRelease | null> {
    const deadline = this.now() + maxWaitMs;
    const s = this.state.get(key) ?? { busy: false, freeAt: 0, waiters: [] };
    this.state.set(key, s);
    for (;;) {
      const t = this.now();
      if (!s.busy && t >= s.freeAt) {
        s.busy = true;
        let released = false;
        return async () => {
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
}

/** Cooldown between two applications to one company: APPLY_COMPANY_COOLDOWN_MS, default 30 s. */
export function defaultCooldownMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.APPLY_COMPANY_COOLDOWN_MS ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

const gates = new WeakMap<Db, CompanyGate>();
/** The gate the runner uses unless one is injected: one per database, shared across calls in this process. */
export function companyGateFor(db: Db): CompanyGate {
  const existing = gates.get(db);
  if (existing) return existing;
  const gate = new CompanyGate(defaultCooldownMs(), Date.now, db);
  gates.set(db, gate);
  return gate;
}
