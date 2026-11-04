import type { NoriPet } from "@norinote/nori-pet";

/*
 * Nori on the auth pages (auth-design-spec.md section 8). It sits on the scene's seat (`data-nori-seat="auth"`, in the
 * column from 1024 px and on the band below), reads along and covers its eyes through nori-pet's `watchFields`, and
 * plays the reactions the forms ask for with a `norinote:react` event (see noriReact in lib/auth-flow.ts).
 */

/** The rows a form needs first, fetched as soon as any field is focused. */
const FIELD_ROWS = ["type-along", "cover", "covered", "peek", "uncover"];
/** The rest of the auth set, fetched once the page has settled. */
const LATER_ROWS = ["key", "shake-no", "nod", "wave", "bow", "check-mail", "sway", "celebrate", "deflated", "comfort"];

const once = (key: string) => {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    // Storage blocked: Nori says hello on every visit, which is harmless.
  }
  return true;
};

export type AuthNori = { destroy: () => void };

/** `arrived`: Nori came from another page of the app, so it glides over instead of saying hello. */
export function startAuthNori(pet: NoriPet, { arrived }: { arrived: boolean }): AuthNori {
  const offs: (() => void)[] = [];
  const listen = (target: EventTarget, name: string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    target.addEventListener(name, fn, opts);
    offs.push(() => target.removeEventListener(name, fn, opts));
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The visible seat: the other one sits inside a box hidden at this width.
  const seat = () => [...document.querySelectorAll('[data-nori-seat="auth"]')].find((el) => el.getClientRects().length > 0) ?? null;

  /** Sits Nori on the seat; with glide it travels there from wherever it was, as on the landing page. */
  const sit = (glide: boolean) => {
    const el = seat();
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
    // Rows go through react() too, so celebrate and deflated end a running loop (signing-in's key, loading's sway).
    const played = pet.react(row ?? event ?? "idle", say ? { say } : undefined);
    void Promise.resolve(played).then(
      () => done?.(),
      () => done?.(),
    );
  });

  // Rows: the field set on the first focus, everything else once the page has gone quiet. On a fresh visit Nori waves
  // then too (its strip is 70 KB, kept off the first screen), unless the visitor has already started typing.
  const fetchRows = (rows: string[]) => rows.forEach((r) => void pet.preload(r).catch(() => {}));
  let typing = document.activeElement instanceof HTMLInputElement && document.activeElement.value !== "";
  listen(document, "focusin", () => fetchRows(FIELD_ROWS), { once: true });
  listen(document, "input", () => (typing = true), { once: true });
  let idle = 0;
  const later = () => {
    idle = window.setTimeout(() => {
      fetchRows(FIELD_ROWS);
      fetchRows(LATER_ROWS);
      if (!arrived && !typing && once("norinote-auth-hello")) void pet.react("hello");
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
