import type { NoriPet } from "@norinote/nori-pet";

/*
 * Nori's choreography on the landing page (spec section 9, ui-plan.md "How Nori behaves on the page").
 *
 * Every section marks where Nori sits with `data-nori-seat`. The section that covers the most of the screen (at least
 * 40% of it) is the current one. From 1024 px Nori hops to that section's seat; narrower, it sits on the hero's hill
 * and docks in the corner for the rest, playing each section's cue in place. A cue starts once Nori has arrived and
 * stops when the section changes. If the visitor drags Nori somewhere, it stays there for the visit (cues still play).
 */

type Ctx = {
  pet: NoriPet;
  section: HTMLElement;
  /** Moves Nori to a seat (desktop and not moved by the visitor), or keeps it docked. */
  seat: (el: Element | null) => void;
  /** True the first time this key is asked about during the visit. */
  once: (key: string) => boolean;
};

type Cue = {
  /** Rows to fetch before Nori gets here. */
  rows: string[];
  /** The seat Nori goes to first; default: the section's first `data-nori-seat`. */
  start?: (section: HTMLElement) => Element | null;
  /** Starts the cue; returns a cleanup for when the section changes. */
  enter: (c: Ctx) => void | (() => void);
};

const after = (ms: number, fn: () => void) => {
  const t = window.setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * Runs fn once the page has loaded and gone quiet for a moment, so Nori's extra strips (about 70 KB each) never
 * compete with the first screen (spec section 13: under 500 KB before the first scroll). Returns a cancel.
 */
const settled = (fn: () => void) => {
  let off = false;
  const go = () => {
    const t = window.setTimeout(() => {
      if (off) return;
      if ("requestIdleCallback" in window) requestIdleCallback(() => !off && fn(), { timeout: 2000 });
      else fn();
    }, 1500);
    return t;
  };
  let t = 0;
  if (document.readyState === "complete") t = go();
  else addEventListener("load", () => (t = go()), { once: true });
  return () => {
    off = true;
    clearTimeout(t);
  };
};

const listen = (name: string, fn: (e: Event) => void, target: EventTarget = window) => {
  target.addEventListener(name, fn);
  return () => target.removeEventListener(name, fn);
};

/** The cue for each seat name; keys match `data-nori-seat` (how-1…4 and smarter-* share one cue). */
const CUES: Record<string, Cue> = {
  hero: {
    rows: ["wave", "point-down"],
    enter: ({ pet, once }) => {
      let off = false;
      // The wave waits for its strip, which loads once the page has settled; then, after a few quiet seconds, Nori
      // points down the page.
      const stop = settled(() => {
        if (once("hello")) pet.preload("wave").then(() => !off && pet.react("hello"));
      });
      const later = after(7000, () => pet.preload("point-down").then(() => !off && pet.react("scroll-cue")));
      return () => {
        off = true;
        stop();
        later();
      };
    },
  },
  noboard: {
    rows: ["search"],
    enter: ({ pet, once }) => {
      pet.react("searching", once("noboard") ? { say: "Hundreds of listings. These 3 fit you." } : {});
    },
  },
  how: {
    rows: ["read", "think", "papers", "laptop"],
    start: (s) => s.querySelector("[data-nori-seat][data-active]") ?? s.querySelector("[data-nori-seat]"),
    enter: ({ pet, section, seat }) => {
      const steps = [
        () => pet.react("prepared", { note: null }),
        () => pet.react("preparing"),
        () => pet.play("papers", { loop: true }),
        () => pet.play("laptop", { loop: true }),
      ];
      let shown = -1;
      const sync = () => {
        const active = section.querySelector<HTMLElement>("[data-nori-seat][data-active]");
        const i = Number(active?.dataset.step ?? 0);
        if (i === shown) return;
        shown = i;
        seat(active);
        pet.setNote(null);
        steps[i]?.();
      };
      sync();
      const mo = new MutationObserver(sync);
      mo.observe(section, { subtree: true, attributes: true, attributeFilter: ["data-active"] });
      return () => mo.disconnect();
    },
  },
  replay: {
    rows: ["scribble", "wait", "catch", "hold", "dash", "hop"],
    enter: ({ pet, section }) => {
      const act = (phase: string, code = "482 913") => pet.react(phase, phase === "code" ? { note: code } : {});
      // The run may have started before Nori landed: pick it up where it is (a finished run just rests).
      const now = section.dataset.phase;
      if (now && now !== "submitted") act(now);
      return listen("norinote:replay", (e) => {
        const { phase, code } = (e as CustomEvent<{ phase: string; code: string }>).detail;
        act(phase, code);
      });
    },
  },
  tailored: {
    rows: ["read"],
    enter: ({ pet }) => {
      pet.react("prepared", { note: "2 changed" });
    },
  },
  incharge: {
    rows: ["wait", "nod"],
    enter: ({ pet }) => {
      pet.play("wait", { loop: true });
      return listen("norinote:answer", () => {
        pet.play("nod").then(() => pet.react("idle"));
      });
    },
  },
  smarter: {
    rows: ["celebrate", "deflated", "comfort"],
    start: (s) => s.querySelector('[data-nori-seat="smarter-interview"]'),
    enter: ({ pet, section, seat, once }) => {
      if (!once("smarter")) return;
      pet.react("interview");
      return after(2600, () => {
        seat(section.querySelector('[data-nori-seat="smarter-rejection"]'));
        pet.react("rejection");
      });
    },
  },
  wherever: {
    rows: ["check-mail"],
    enter: ({ pet }) => {
      pet.react("email-sent");
    },
  },
  pricing: {
    rows: ["relax"],
    enter: ({ pet }) => {
      pet.react("relaxing");
    },
  },
  faq: {
    rows: ["think"],
    enter: ({ pet, section }) => {
      // Nori thinks while an answer is open.
      const sync = () => pet.react(section.querySelector("details[open]") ? "preparing" : "idle");
      sync();
      return listen("toggle", sync, section);
    },
  },
  final: {
    rows: ["heart", "bow"],
    enter: ({ pet }) => {
      pet.react("thanks");
    },
  },
  footer: {
    rows: ["sleep"],
    // Linger on the footer for about 20 seconds and Nori falls asleep; any event wakes it.
    enter: ({ pet }) => after(20_000, () => pet.react("cap-reached")),
  },
};

const cueKey = (seatName: string) => seatName.replace(/-.*$/, "");

/** The marker that's showing (the hero has one per breakpoint; the hidden one has no layout box). */
const visible = (el: Element | null) => (el && el.getClientRects().length > 0 ? el : null);

export type Choreo = { destroy: () => void; section: () => string | null };

/**
 * Starts the choreography on the current page; returns null when the page has no seats. `onSignup` runs after Nori is
 * dropped on the final call to action and has bowed.
 */
export function startChoreo(pet: NoriPet, { onSignup }: { onSignup: () => void }): Choreo | null {
  const seats = [...document.querySelectorAll<HTMLElement>("[data-nori-seat]")];
  if (!seats.length) {
    pet.sitOn(null);
    return null;
  }

  // One entry per section, in page order.
  const sections: { el: HTMLElement; key: string }[] = [];
  for (const s of seats) {
    const el = s.closest<HTMLElement>("section, footer");
    const key = cueKey(s.dataset.noriSeat ?? "");
    if (el && CUES[key] && !sections.some((x) => x.el === el)) sections.push({ el, key });
  }

  const seen = new Set<string>();
  const once = (k: string) => (seen.has(k) ? false : (seen.add(k), true));
  const desktop = matchMedia("(min-width: 1024px)");
  const noriEl = () => document.querySelector<HTMLElement>(".nori");
  let free = false; // the visitor moved Nori; it stays where they put it
  try {
    free = sessionStorage.getItem("norinote-nori-free") === "1";
  } catch {
    // Storage blocked: Nori just keeps its seats.
  }

  let current: { key: string; el: HTMLElement } | null = null;
  let cleanup: (() => void) | void;
  let seatEl: Element | null = null;
  let parked = false;
  let seq = 0;

  /** Where Nori would stand on a seat (sitOn's own maths), as a box. */
  const standing = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2 - pet.size / 2;
    const y = r.top - pet.size * (1 - 0.04);
    return { left: x, top: y, right: x + pet.size, bottom: y + pet.size };
  };

  /**
   * True when a box would cover something Nori must never cover (spec section 9): a heading, a link or button, a form
   * field. Nori's own note in the hero lives inside its seat and doesn't count. 6 px of grace for soft sprite edges.
   */
  const covers = (b: { left: number; top: number; right: number; bottom: number }) =>
    [...document.querySelectorAll("h1, h2, a[href], button, input, textarea, summary")].some((el) => {
      // .nori-seat is a scene's seat marker (the hero's holds Nori's note); card seats like the Pro card do count.
      if (!el.getClientRects().length || el.closest(".nori, .nori-seat, dialog")) return false;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return false;
      return b.left < r.right - 6 && r.left < b.right - 6 && b.top < r.bottom - 6 && r.top < b.bottom - 6;
    });

  /** A seat Nori can stand on: below the sticky nav with room for Nori above it, not off the bottom, covering nothing. */
  const roomy = (el: Element) => {
    const top = el.getBoundingClientRect().top;
    return top > 72 + pet.size * 0.9 && top < innerHeight - 8 && !covers(standing(el));
  };

  // Docked in the corner, Nori tucks itself away (peeking over the bottom edge) while the corner would cover a button
  // or heading, and comes back when it's clear. A visitor who clicks a tucked Nori to bring it back keeps it out.
  // (Some reactions untuck Nori by themselves, so an untucked Nori alone doesn't mean the visitor did it.)
  let autoTucked = false;
  let tuckOverride = false;
  let guardTimer = 0;
  const onNoriDown = () => {
    if (pet.tucked) tuckOverride = true;
  };
  const guardDock = () => {
    clearTimeout(guardTimer);
    guardTimer = window.setTimeout(() => {
      if (tuckOverride || pet.activity === "sleep") return;
      if (autoTucked && !pet.tucked) autoTucked = false;
      const seated = !!seatEl && !parked && !free && !pet.tucked && (desktop.matches || current?.key === "hero");
      if (seated && !autoTucked) return;
      const at = pet.tucked ?? { x: pet.x, y: pet.y };
      const blocked = covers({ left: at.x, top: at.y, right: at.x + pet.size, bottom: at.y + pet.size });
      if (blocked && !pet.tucked) {
        autoTucked = true;
        pet.tuck();
      } else if (!blocked && autoTucked) {
        autoTucked = false;
        pet.untuck();
      }
    }, 260);
  };

  /**
   * Sits Nori on a seat, then lets nori-pet keep it there through scrolling. "hop" glides over with a hop (arriving in a
   * section) and resolves once it lands; "glide" just glides (the next step in a section); "none" jumps. A seat with no
   * room parks Nori in the corner until it has room.
   */
  const sit = (el: Element | null, how: "hop" | "glide" | "none" = "hop") => {
    seatEl = el;
    const target = visible(el);
    const allowed = target && !free && (desktop.matches || current?.key === "hero");
    // A Nori this page tucked away comes back out for a seat; one the visitor tucked stays tucked.
    if (allowed && autoTucked && pet.tucked && roomy(target)) {
      autoTucked = false;
      pet.untuck();
    }
    const canSeat = allowed && !pet.tucked;
    if (!canSeat || !roomy(target)) {
      parked = !!canSeat;
      pet.sitOn(null);
      guardDock();
      return Promise.resolve();
    }
    parked = false;
    // Scene seats are 1 px markers at the feet; card seats are the card's top edge. Either way the feet land on it.
    const fromX = pet.x;
    const fromY = pet.y;
    pet.sitOn(target, { overlap: 0.04 });
    if (how === "none" || (Math.abs(pet.x - fromX) < 4 && Math.abs(pet.y - fromY) < 4)) return Promise.resolve();
    const toX = pet.x;
    const toY = pet.y;
    pet.moveTo(fromX, fromY);
    return new Promise<void>((done) =>
      requestAnimationFrame(() => {
        pet.moveTo(toX, toY, true);
        if (how === "hop") pet.play("hop").then(() => done());
        else done();
      }),
    );
  };

  const enter = async (next: { key: string; el: HTMLElement } | null) => {
    if (next?.el === current?.el) return;
    const token = ++seq;
    if (typeof cleanup === "function") cleanup();
    cleanup = undefined;
    current = next;
    if (!next) return;
    const cue = CUES[next.key];
    if (!cue) return;
    const start = cue.start?.(next.el) ?? next.el.querySelector("[data-nori-seat]");
    // The hero has a seat per breakpoint; take the one that's showing. On the page's first section Nori simply
    // appears in its seat (no hop, so no hop strip to fetch on the first screen).
    const first = !entered;
    entered = true;
    await sit(next.key === "hero" ? [...next.el.querySelectorAll("[data-nori-seat]")].find((s) => visible(s)) ?? null : start, first ? "none" : "hop");
    // The visitor moved on while Nori was hopping: that section's cue never starts.
    if (token !== seq) return;
    cleanup = cue.enter({ pet, section: next.el, seat: (el) => void sit(el, "glide"), once });
    // Fetch the next section's rows while the visitor reads this one, once the page has settled.
    const i = sections.findIndex((s) => s.el === next.el);
    const upcoming = sections[i + 1];
    if (upcoming) prefetchers.push(settled(() => ["hop", ...(CUES[upcoming.key]?.rows ?? [])].forEach((r) => pet.preload(r))));
  };
  let entered = false;
  const prefetchers: (() => void)[] = [];

  // The current section: the one covering the most of the screen, if that's at least 40% of it.
  const cover = new Map<HTMLElement, number>();
  let pending = 0;
  const pick = () => {
    let best: { key: string; el: HTMLElement } | null = null;
    let most = 0.4;
    for (const s of sections) {
      const c = cover.get(s.el) ?? 0;
      if (c >= most) {
        most = c;
        best = s;
      }
    }
    if (best && best.el !== current?.el) void enter(best);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) cover.set(e.target as HTMLElement, e.intersectionRect.height / (e.rootBounds?.height || innerHeight));
      // Wait for scrolling to settle a moment, so a fast scroll doesn't send Nori through every seat.
      clearTimeout(pending);
      pending = window.setTimeout(pick, 180);
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
  );
  sections.forEach((s) => io.observe(s.el));
  // nori-pet runs with preload "lazy" here (spec section 13); the blink it plays every few seconds comes once the page
  // has settled.
  prefetchers.push(settled(() => pet.preload("blink")));
  noriEl()?.addEventListener("pointerdown", onNoriDown);

  // A seat that scrolls out from under the nav or off the bottom parks Nori in the corner until it's back.
  let raf = 0;
  const onScroll = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      guardDock();
      const t = visible(seatEl);
      if (!t || free) return;
      const out = !roomy(t);
      if (out && !parked) {
        parked = true;
        pet.sitOn(null);
      } else if (!out && parked) {
        void sit(seatEl, "glide");
      }
    });
  };
  addEventListener("scroll", onScroll, { passive: true });

  // Crossing 1024 px changes whether Nori hops; re-seat for the new width.
  const onWidth = () => void sit(seatEl, "none");
  desktop.addEventListener("change", onWidth);

  // The visitor dragged Nori: it stays where they put it for the rest of the visit.
  const root = noriEl();
  let wasDragging = false;
  const mo = new MutationObserver(() => {
    const dragging = !!root?.classList.contains("is-dragging");
    if (wasDragging && !dragging) {
      free = true;
      try {
        sessionStorage.setItem("norinote-nori-free", "1");
      } catch {
        // Fine: only this page view remembers it.
      }
    }
    wasDragging = dragging;
  });
  if (root) mo.observe(root, { attributes: true, attributeFilter: ["class"] });

  // Dropped on the final call to action: a bow, then sign-up.
  const offDrop = pet.on("drop", ({ id }) => {
    if (id !== "signup") return;
    pet.react("welcome").then(onSignup);
  });

  return {
    section: () => current?.key ?? null,
    destroy() {
      if (typeof cleanup === "function") cleanup();
      io.disconnect();
      mo.disconnect();
      clearTimeout(pending);
      clearTimeout(guardTimer);
      prefetchers.forEach((off) => off());
      noriEl()?.removeEventListener("pointerdown", onNoriDown);
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
      desktop.removeEventListener("change", onWidth);
      offDrop();
    },
  };
}
