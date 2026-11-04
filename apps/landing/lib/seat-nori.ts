import type { NoriPet } from "@norinote/nori-pet";

/*
 * Nori on a page with one scene seat: the auth pages (auth spec section 8) and onboarding (onboarding spec section 10).
 * It sits on `data-nori-seat="<seat>"` (in the column from 1024 px, on the band below), reads along and covers its eyes
 * through nori-pet's `watchFields` where a form marks its fields, and plays the reactions the page asks for with a
 * `norinote:react` event (see noriReact in lib/auth-flow.ts).
 */

const once = (key: string) => {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: Nori greets on every visit, which is harmless.
  }
  return true;
};

export type SeatNoriOptions = {
  /** Seat names in order of preference; the first one visible at this width is used. */
  seat: string | string[];
  /** Nori came from another page of the app, so it glides to the seat. */
  arrived: boolean;
  /** The reaction played once per visit after the page settles, and whether it waits for a fresh visit. */
  greet: { event: string; key: string; onlyFresh: boolean };
  /** Rows fetched as soon as any field is focused, and the rest once the page has settled. */
  fieldRows: string[];
  laterRows: string[];
};

export type SeatNori = { destroy: () => void };

export function startSeatNori(pet: NoriPet, { seat, arrived, greet, fieldRows, laterRows }: SeatNoriOptions): SeatNori {
  const offs: (() => void)[] = [];
  const listen = (target: EventTarget, name: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(name, fn, opts);
    offs.push(() => target.removeEventListener(name, fn, opts));
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The visible seat: the others sit inside boxes hidden at this width.
  const names = Array.isArray(seat) ? seat : [seat];
  const seatEl = () => names.flatMap((n) => [...document.querySelectorAll(`[data-nori-seat="${n}"]`)]).find((el) => el.getClientRects().length > 0) ?? null;

  /** Sits Nori on the seat; with glide it travels there from wherever it was, as on the landing page. */
  const sit = (glide: boolean) => {
    const el = seatEl();
    if (!el) return pet.sitOn(null);
    const fromX = pet.x;
    const fromY = pet.y;
    pet.sitOn(el, { overlap: 0.04 });
    if (!glide || still || (Math.abs(pet.x - fromX) < 4 && Math.abs(pet.y - fromY) < 4)) return;
    const toX = pet.x;
    const toY = pet.y;
    pet.moveTo(fromX, fromY);
    requestAnimationFrame(() => pet.moveTo(toX, toY, true));
  };

  sit(arrived);

  const wide = matchMedia("(min-width: 1024px)");
  const onWidth = () => sit(false);
  wide.addEventListener("change", onWidth);
  offs.push(() => wide.removeEventListener("change", onWidth));

  // Content above the seat can change height after Nori sits (data arriving, a banner, fonts): sit again when it does.
  // nori-pet follows scroll and window resizes by itself, but not the page reflowing under it.
  const main = document.getElementById("main");
  if (main && "ResizeObserver" in window) {
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => sit(false));
    });
    ro.observe(main);
    offs.push(() => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    });
  }

  // Reading along and covering its eyes, re-wired whenever a form's fields change.
  let unwire: (() => void) | null = null;
  const wire = () => {
    unwire?.();
    const main = document.getElementById("main");
    const text = [...(main?.querySelectorAll<HTMLInputElement>('input[data-nori-watch="text"]') ?? [])];
    const password = main?.querySelector<HTMLInputElement>('input[data-nori-watch="password"]') ?? undefined;
    const reveal = main?.querySelector<HTMLElement>('[data-nori-watch="reveal"]') ?? undefined;
    unwire = text.length || password ? pet.watchFields({ text, password, reveal }) : null;
  };
  wire();
  listen(window, "norinote:fields", wire);

  listen(window, "norinote:react", (e) => {
    const { event, row, say, done } = (e as CustomEvent<{ event?: string; row?: string; say?: string; done?: () => void }>).detail;
    // Words alone are a bubble; rows go through react() too, so celebrate and deflated end a running loop (signing-in's
    // key, loading's sway).
    const played = !row && !event && say ? pet.say(say) : pet.react(row ?? event ?? "idle", say ? { say } : undefined);
    void Promise.resolve(played).then(
      () => done?.(),
      () => done?.(),
    );
  });

  // Rows: the field set on the first focus, everything else once the page has gone quiet. The greeting waits for then
  // too (its strip is about 70 KB, kept off the first screen), and is skipped once the visitor has started typing.
  const fetchRows = (rows: string[]) => rows.forEach((r) => void pet.preload(r).catch(() => {}));
  let typing = document.activeElement instanceof HTMLInputElement && document.activeElement.value !== "";
  listen(document, "focusin", () => fetchRows(fieldRows), { once: true });
  listen(document, "input", () => (typing = true), { once: true });
  let idle = 0;
  const later = () => {
    idle = window.setTimeout(() => {
      fetchRows(fieldRows);
      fetchRows(laterRows);
      if ((!greet.onlyFresh || !arrived) && !typing && once(greet.key)) void pet.react(greet.event);
    }, 1500);
  };
  if (document.readyState === "complete") later();
  else listen(window, "load", later, { once: true });
  offs.push(() => clearTimeout(idle));

  return {
    destroy() {
      unwire?.();
      offs.forEach((off) => off());
    },
  };
}

/** The auth pages: Nori says hello on a fresh visit only. */
export const startAuthNori = (pet: NoriPet, { arrived }: { arrived: boolean }) =>
  startSeatNori(pet, {
    seat: "auth",
    arrived,
    greet: { event: "hello", key: "norinote-auth-hello", onlyFresh: true },
    fieldRows: ["type-along", "cover", "covered", "peek", "uncover"],
    laterRows: ["key", "shake-no", "nod", "wave", "bow", "check-mail", "sway", "celebrate", "deflated", "comfort"],
  });

/** Onboarding: Nori bows once per visit, whether it walked in from sign-up or the page was opened directly. */
export const startOnboardingNori = (pet: NoriPet, { arrived }: { arrived: boolean }) =>
  startSeatNori(pet, {
    seat: "onboarding",
    arrived,
    greet: { event: "welcome", key: "norinote-onboarding-welcome", onlyFresh: false },
    fieldRows: ["read", "papers", "point-right", "present"],
    laterRows: ["bow", "nod", "search", "celebrate", "cover", "covered", "uncover", "shake-no"],
  });

/**
 * The dashboard (4a spec section 10): Nori sits at the rail's foot from 1024 px and on Today's strip below that; the
 * panel and Today ask for the agent events. No greeting of its own: Today waves when new jobs are in.
 */
export const startAppNori = (pet: NoriPet, { arrived }: { arrived: boolean }) =>
  startSeatNori(pet, {
    seat: ["rail", "strip"],
    arrived,
    greet: { event: "idle", key: "norinote-app-greet", onlyFresh: true },
    fieldRows: [],
    laterRows: ["wave", "papers", "present", "scribble", "dash", "wait", "catch", "point", "deflated", "comfort", "celebrate", "sleep"],
  });
