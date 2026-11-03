// NoriPet: the Norinote companion. Plays the plush sprite rows from assets/nori.json, speaks in bubbles, holds notes,
// reacts to app events, and can be dragged, petted, tucked away and docked. No framework; see react.js for React.
//
//   const nori = await NoriPet.create({ assets: "/nori/" });
//   nori.react("applying");
//   nori.progress({ title: "Acme · Product analyst", step: "Answering 9 questions", percent: 62 });
//   nori.react("code", { note: "482 913", say: "Acme sent a code. Typing it in." });
//   const yes = await nori.ask("Open to relocating to New York?", [{ label: "Yes", value: true }, { label: "No", value: false }]);

// Default assets sit next to this file in the package. Apps should pass `assets` (a public URL); the indirection keeps
// bundlers from treating the folder as a file import.
const ASSETS_DIR = "../assets/";
const defaultAssets = () => new URL(ASSETS_DIR, import.meta.url).href;
const SIZES = { s: 80, m: 112, l: 148 };
// How much of Nori shows when tucked away: enough for the eyes to peek over the edge.
const PEEK = 0.52;
// The visible page area, without scrollbars.
const vw = () => document.documentElement.clientWidth || window.innerWidth;
const vh = () => document.documentElement.clientHeight || window.innerHeight;

/** What each app event looks like. `loop` rows become the ongoing activity until another event replaces it. */
export const REACTIONS = {
  hello: { row: "wave" },
  "shortlist-ready": { row: "wave", fx: "sparkles" },
  preparing: { row: "think", loop: true },
  prepared: { row: "read", loop: true },
  applying: { row: "scribble", loop: true },
  submitting: { row: "dash", loop: true },
  "awaiting-code": { row: "wait", loop: true },
  code: { row: "catch", then: "hold", untuck: true },
  submitted: { row: "hop", fx: "sparkles", tone: "success" },
  "needs-user": { row: "wait", loop: true, fx: "alert", tone: "alert", untuck: true },
  captcha: { row: "deflated", then: "wait", fx: "alert", tone: "alert", untuck: true },
  failed: { row: "deflated", tone: "error" },
  reply: { row: "wave", fx: "sparkles", untuck: true },
  interview: { row: "celebrate", fx: "confetti", tone: "success", untuck: true },
  offer: { row: "celebrate", fx: "confetti", tone: "success", untuck: true },
  rejection: { row: "deflated", then: "comfort" },
  "cap-reached": { row: "sleep", loop: true, fx: "zzz" },
  idle: { row: "idle", loop: true },
  // Sign-in, sign-up and authentication (watchFields wires the first four to a form)
  password: { row: "cover", then: "covered" },
  "password-show": { row: "peek", loop: true },
  "password-hide": { row: "covered", loop: true },
  "password-done": { row: "uncover", end: true },
  "signing-in": { row: "key", loop: true },
  "signed-in": { row: "nod", then: "wave", end: true, tone: "success" },
  "auth-failed": { row: "shake-no", end: true, tone: "error" },
  "email-sent": { row: "check-mail", loop: true },
  welcome: { row: "bow", fx: "hearts", end: true },
  loading: { row: "sway", loop: true },
  // Landing page moments
  "scroll-cue": { row: "point-down", loop: true },
  searching: { row: "search", loop: true },
  speed: { row: "stopwatch", fx: "sparkles", end: true },
  relaxing: { row: "relax", loop: true },
  thanks: { row: "heart", loop: true, fx: "hearts" },
};

const HEART = "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z";
const STAR = "M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z";
const svg = (d, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage may be blocked */ } },
};

export class NoriPet {
  /** Loads the manifest, preloads the idle row and mounts Nori. */
  static async create(options = {}) {
    const assets = options.assets ?? defaultAssets();
    const base = assets.endsWith("/") ? assets : `${assets}/`;
    const manifest = options.manifest ?? (await (await fetch(`${base}nori.json`)).json());
    const pet = new NoriPet({ ...options, assets: base, manifest });
    await pet.ready;
    return pet;
  }

  constructor(options) {
    const saved = store.get(options.storageKey ?? "nori-pet") ?? {};
    this.opts = { size: "m", sleepAfterMs: 120_000, blinkEveryMs: [6000, 12_000], parent: document.body, storageKey: "nori-pet", ...options };
    this.manifest = options.manifest;
    this.base = options.assets;
    this.size = SIZES[saved.size ?? (options.size ? this.opts.size : vw() < 520 ? "s" : this.opts.size)] ?? this.opts.size;
    this.muted = saved.muted ?? false;
    this.history = [];
    this.listeners = new Map();
    this.activity = null; // ongoing loop row ("scribble" while applying), or null
    this.queue = [];
    this.bubbleItem = null;
    this.reduced = this.opts.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mount(saved);
    this.ready = this.preload("idle").then(() => {
      this.play("idle", { loop: true });
      this.root.classList.add("is-ready");
      if ("requestIdleCallback" in window) requestIdleCallback(() => this.preloadAll());
      else setTimeout(() => this.preloadAll(), 1500);
    });
  }

  // ---------- public API ----------

  /** Plays a row once (or looping). Resolves when a one-shot row finishes. */
  play(id, { loop, then } = {}) {
    const row = this.manifest.rows[id];
    if (!row) return Promise.resolve();
    clearTimeout(this.frameTimer);
    this.row = id;
    this.frame = 0;
    const repeat = loop ?? row.loop;
    this.sprite.style.backgroundImage = `url("${this.base}${row.src}")`;
    this.sprite.style.backgroundSize = `${row.frames * this.size}px ${this.size}px`;
    this.motion(id, row);
    this.placeBubble();
    return new Promise((done) => {
      if (this.reduced) {
        this.showFrame(repeat ? 0 : row.frames - 1);
        const hold = row.ms.reduce((a, b) => a + b, 0);
        this.frameTimer = setTimeout(() => { if (!repeat) this.afterRow(then); done(); }, repeat ? 0 : hold);
        return;
      }
      const step = () => {
        this.showFrame(this.frame);
        const ms = row.ms[this.frame] || 450;
        this.frameTimer = setTimeout(() => {
          if (this.frame < row.frames - 1) { this.frame++; step(); }
          else if (repeat) { this.frame = 0; step(); }
          else { this.afterRow(then); done(); }
        }, ms);
      };
      step();
    });
  }

  /** Reacts to an app event (see REACTIONS) and optionally says something or holds a note. */
  async react(event, { say, note, tone, ms, actions } = {}) {
    const r = REACTIONS[event] ?? { row: event };
    this.touch();
    this.following = false;
    this.clearFx("alert");
    if (this.row === "sleep" && event !== "cap-reached") { this.clearFx("zzz"); this.activity = null; await this.play("wake"); }
    if (r.untuck && this.tucked) this.untuck();
    if (r.fx) this.fx(r.fx);
    if (note != null) this.setNote(note);
    else if (!["catch", "hold", "read", "scribble"].includes(r.row)) this.setNote(null);
    if (say) {
      const item = { text: say, tone: tone ?? r.tone ?? "info", ms: ms ?? (actions ? 0 : 4200), actions };
      if (actions) return Promise.all([this.runReaction(r), this.enqueue(item)]).then(([, v]) => v);
      this.enqueue(item);
    }
    return this.runReaction(r);
  }

  /** Sits Nori on top of an element (a sign-in card), feet a little over its top edge; follows scroll and resize. */
  sitOn(el, { overlap = 0.16, align = "center" } = {}) {
    this.seat = el ? { el, overlap, align } : null;
    if (!el) { this.placeDock(true); return; }
    const r = el.getBoundingClientRect();
    const x = align === "left" ? r.left + 12 : align === "right" ? r.right - this.size - 12 : r.left + r.width / 2 - this.size / 2;
    this.moveTo(x, r.top - this.size * (1 - overlap));
  }

  /** Eyes follow a text caret: 0 is the field's left end, 1 its right end; null stops following. */
  follow(fraction) {
    const row = this.manifest.rows["type-along"];
    if (!row) return;
    if (fraction == null) { if (this.following) { this.following = false; this.backToRest(); } return; }
    this.touch();
    if (!this.following || this.row !== "type-along") {
      clearTimeout(this.frameTimer); clearTimeout(this.idleTimer);
      this.bodyAnim?.cancel();
      this.following = true;
      this.row = "type-along";
      this.sprite.style.backgroundImage = `url("${this.base}${row.src}")`;
      this.sprite.style.backgroundSize = `${row.frames * this.size}px ${this.size}px`;
      this.placeBubble();
    }
    this.showFrame(Math.round(Math.max(0, Math.min(1, fraction)) * (row.frames - 1)));
  }

  /**
   * Wires a sign-in or sign-up form: Nori reads along in text fields, covers its eyes in the password field and peeks
   * when the password is shown. `reveal` is the show-password control. Returns a function that unwires it.
   */
  watchFields({ text = [], password, reveal } = {}) {
    const offs = [];
    const on = (el, type, fn) => { el.addEventListener(type, fn); offs.push(() => el.removeEventListener(type, fn)); };
    const measure = document.createElement("canvas").getContext("2d");
    const caret = (input) => {
      const style = getComputedStyle(input);
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = measure.measureText(input.value.slice(0, input.selectionStart ?? input.value.length)).width;
      // Typical text fills about half a field, so the eyes cover their whole range over that half.
      return width / Math.max(1, (input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) * 0.55);
    };
    for (const input of text) {
      for (const type of ["focus", "input", "keyup", "click"]) on(input, type, () => this.follow(caret(input)));
      on(input, "blur", () => this.follow(null));
    }
    if (password) {
      // Reacts only on a change: covering, peeking, or leaving the field (focus moving to the show button is staying).
      let mode = null;
      const sync = () => {
        const inside = document.activeElement === password || (reveal && document.activeElement === reveal);
        const want = !inside ? null : password.type === "text" ? "peek" : "covered";
        if (want === mode) return;
        // Leaving the field after something else took over (submitting: the key) needs no uncovering.
        if (want === null && !["cover", "covered", "peek"].includes(this.row)) { mode = null; return; }
        this.react(want === null ? "password-done" : want === "peek" ? "password-show" : mode === null ? "password" : "password-hide");
        mode = want;
      };
      on(password, "focus", sync);
      on(password, "blur", () => setTimeout(sync, 0));
      if (reveal) { on(reveal, "click", () => setTimeout(sync, 0)); on(reveal, "blur", () => setTimeout(sync, 0)); }
    }
    return () => offs.forEach((off) => off());
  }

  /** A bubble that disappears on its own. */
  say(text, { tone = "info", ms = 4200, title } = {}) { this.touch(); return this.enqueue({ text, tone, ms, title }); }

  /** A sticky question with buttons; resolves with the chosen value. */
  ask(text, actions, { tone = "alert", title } = {}) { this.touch(); return this.enqueue({ text, tone, ms: 0, actions, title }); }

  /** Shows or updates the live progress bubble (title, step, percent 0..100, startedAt). */
  progress({ title, step, percent = 0, startedAt } = {}) {
    this.touch();
    const prev = this.bubbleItem?.progress ? this.bubbleItem : this.queue.find((q) => q.progress);
    const item = { progress: true, title, text: step, percent, startedAt: startedAt ?? prev?.startedAt ?? Date.now(), tone: "info", ms: 0 };
    if (prev) { Object.assign(prev, item); if (prev === this.bubbleItem) this.renderBubble(prev); }
    else this.enqueue(item);
    if (this.activity !== "scribble" && this.activity !== "dash") this.react("applying");
  }

  /** Ends the progress bubble with a closing line (and the hop). */
  progressDone(text, { tone = "success" } = {}) {
    this.queue = this.queue.filter((q) => !q.progress);
    if (this.bubbleItem?.progress) this.closeBubble();
    return this.react("submitted", { say: text, tone });
  }

  /** Puts a short text on the card in Nori's hand (null clears it). */
  setNote(text) {
    this.noteText = text;
    this.note.textContent = text ?? "";
    this.syncNote();
  }

  /** Walks to an element and points at it, with an optional line. */
  async pointAt(el, say) {
    const r = el.getBoundingClientRect();
    const right = r.left + r.width / 2 < vw() / 2;
    const x = right ? Math.min(vw() - this.size - 8, r.right + 12) : Math.max(8, r.left - this.size - 12);
    await this.walkTo(x, Math.min(vh() - this.size - 8, Math.max(8, r.top + r.height / 2 - this.size / 2)));
    this.activity = null;
    this.play(right ? "point" : "point-right", { loop: true });
    if (say) this.say(say);
  }

  tuck() {
    this.tucked = { x: this.x, y: this.y };
    this.clearBubble();
    this.root.classList.add("is-tucked");
    this.moveTo(this.x, vh() - this.size * PEEK, true);
    this.play("idle", { loop: true });
  }

  untuck() {
    if (!this.tucked) return;
    const { x, y } = this.tucked;
    this.tucked = null;
    this.root.classList.remove("is-tucked");
    if (this.seat) this.sitOn(this.seat.el, this.seat);
    else this.moveTo(...this.clamp(x, y), true);
    this.resumeBubbles();
  }

  setSize(key) {
    this.size = SIZES[key] ?? this.size;
    this.root.style.setProperty("--nori-size", `${this.size}px`);
    this.save({ size: key });
    if (this.row === "look" || this.row === "type-along") this.rest();
    else this.play(this.row, { loop: this.manifest.rows[this.row]?.loop });
    if (this.seat) this.sitOn(this.seat.el, this.seat);
    else this.moveTo(...this.clamp(this.x, this.y));
  }

  mute(on = true) { this.muted = on; this.save({ muted: on }); if (on) this.clearBubble(); }

  on(name, fn) { (this.listeners.get(name) ?? this.listeners.set(name, new Set()).get(name)).add(fn); return () => this.listeners.get(name)?.delete(fn); }

  destroy() {
    clearTimeout(this.frameTimer); clearTimeout(this.idleTimer); clearTimeout(this.sleepTimer); clearTimeout(this.bubbleTimer); clearInterval(this.tickTimer);
    removeEventListener("pointermove", this.onDocMove);
    removeEventListener("resize", this.onResize);
    removeEventListener("scroll", this.onResize);
    this.resizeObs?.disconnect();
    this.root.remove();
  }

  // ---------- internals ----------

  mount(saved) {
    const root = document.createElement("div");
    root.className = "nori";
    root.style.setProperty("--nori-size", `${this.size}px`);
    root.innerHTML = `
      <div class="nori-bubble" hidden></div>
      <div class="nori-body" tabindex="0" role="button" aria-label="Nori, your job agent. Enter to say hi, Escape to tuck away.">
        <div class="nori-sprite"></div>
        <div class="nori-note" aria-hidden="true"></div>
        <div class="nori-fx" aria-hidden="true"></div>
      </div>
      <div class="nori-live" aria-live="polite"></div>`;
    this.opts.parent.appendChild(root);
    this.root = root;
    this.body = root.querySelector(".nori-body");
    this.sprite = root.querySelector(".nori-sprite");
    this.note = root.querySelector(".nori-note");
    this.fxLayer = root.querySelector(".nori-fx");
    this.bubble = root.querySelector(".nori-bubble");
    this.live = root.querySelector(".nori-live");
    // Text can reflow after it is shown (web fonts arriving, progress updates): re-place so it never runs off-screen.
    if ("ResizeObserver" in window) { this.resizeObs = new ResizeObserver(() => this.placeBubble()); this.resizeObs.observe(this.bubble); }
    this.dock = saved.pos ?? { side: "right", y: null };
    this.placeDock();
    this.bindInput();
  }

  /** Where Nori rests: a side of the window and a height (null is the bottom corner). */
  placeDock(smooth = false) {
    const x = this.dock.side === "left" ? 16 : vw() - this.size - 16;
    this.moveTo(...this.clamp(x, this.dock.y ?? vh() - this.size - 16), smooth);
  }

  preload(id) {
    const row = this.manifest.rows[id];
    if (!row) return Promise.resolve();
    return new Promise((done) => { const img = new Image(); img.onload = img.onerror = done; img.src = `${this.base}${row.src}`; });
  }

  preloadAll() { for (const id of Object.keys(this.manifest.rows)) this.preload(id); }

  showFrame(i) {
    this.frame = i;
    this.sprite.style.backgroundPosition = `${-i * this.size}px 0`;
    this.syncNote();
  }

  syncNote() {
    const row = this.manifest.rows[this.row];
    const at = this.noteText ? row?.anchors?.note?.[this.frame] : null;
    this.note.classList.toggle("is-on", Boolean(at));
    if (!at) return;
    const k = this.size / this.manifest.cell;
    this.note.style.transform = `translate(${at[0] * k}px, ${at[1] * k}px) translate(-50%, -50%) rotate(-4deg)`;
  }

  afterRow(then) {
    if (then) { this.play(then, { loop: this.manifest.rows[then]?.loop }); if (this.manifest.rows[then]?.loop) this.activity = then; return; }
    this.backToRest();
  }

  backToRest() {
    if (this.activity) this.play(this.activity, { loop: true });
    else this.rest();
  }

  /** Idle loop with occasional blinks; sleeps after a long quiet spell. */
  rest() {
    this.activity = null;
    this.play("idle", { loop: true });
    clearTimeout(this.idleTimer);
    const [lo, hi] = this.opts.blinkEveryMs;
    this.idleTimer = setTimeout(() => { if (this.row === "idle" && !this.dragging) this.play("blink"); }, lo + Math.random() * (hi - lo));
  }

  runReaction(r) {
    clearTimeout(this.idleTimer);
    if (r.loop) { this.activity = r.row; return this.play(r.row, { loop: true }); }
    // A one-shot that is the natural end of the ongoing activity clears it (submitted ends applying, signed-in ends
    // unlocking); a `then` loop row becomes the new activity when the one-shot finishes.
    if (r.end || ["hop", "celebrate", "deflated", "wave"].includes(r.row)) this.activity = null;
    return this.play(r.row, { loop: false, then: r.then });
  }

  touch() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = setTimeout(() => {
      if (this.activity || this.dragging || this.bubbleItem?.actions) return;
      this.activity = "sleep";
      this.fx("zzz");
      this.play("sleep", { loop: true });
    }, this.opts.sleepAfterMs);
  }

  /** Code-driven movement layered on the sprite: hops, the landing drop, a little lift when celebrating. */
  motion(id) {
    this.bodyAnim?.cancel();
    if (this.reduced) return;
    const s = this.size;
    const k = {
      hop: [{ transform: "translateY(0)" }, { transform: `translateY(${-s * 0.06}px)`, offset: 0.15 }, { transform: `translateY(${-s * 0.32}px)`, offset: 0.4 }, { transform: `translateY(${-s * 0.22}px)`, offset: 0.6 }, { transform: "translateY(0)", offset: 0.8 }, { transform: "translateY(0)" }],
      celebrate: [{ transform: "translateY(0)" }, { transform: `translateY(${-s * 0.18}px)`, offset: 0.3 }, { transform: `translateY(${-s * 0.18}px)`, offset: 0.7 }, { transform: "translateY(0)" }],
      land: [{ transform: `translateY(${-s * 0.25}px)` }, { transform: "translateY(0)", offset: 0.25 }, { transform: "translateY(0)" }],
      petted: [{ transform: "scale(1)" }, { transform: "scale(1.05, 0.95)", offset: 0.3 }, { transform: "scale(1)" }],
      wake: [{ transform: "translateY(0)" }, { transform: `translateY(${-s * 0.04}px)`, offset: 0.7 }, { transform: "translateY(0)" }],
    }[id];
    if (!k) return;
    const row = this.manifest.rows[id];
    this.bodyAnim = this.body.animate(k, { duration: row.ms.reduce((a, b) => a + b, 0), easing: "cubic-bezier(.3,.7,.4,1)" });
  }

  // ---------- position, drag, input ----------

  clamp(x, y) {
    return [Math.min(Math.max(8, x), vw() - this.size - 8), Math.min(Math.max(8, y), vh() - this.size - 8)];
  }

  moveTo(x, y, smooth = false) {
    this.x = x; this.y = y;
    this.root.style.transition = smooth && !this.reduced ? "transform .45s cubic-bezier(.2,.8,.2,1)" : "none";
    this.root.style.transform = `translate(${x}px, ${y}px)`;
    this.placeBubble();
  }

  /** Walks along the floor line it is on to x (and glides to y); resolves on arrival. */
  walkTo(x, y = this.y) {
    const dx = x - this.x;
    if (this.reduced || Math.abs(dx) < 6) { this.moveTo(x, y, !this.reduced); return Promise.resolve(); }
    const ms = Math.min(2600, Math.max(380, Math.abs(dx) / 0.22));
    this.play(dx > 0 ? "walk" : "walk-left", { loop: true });
    return new Promise((done) => {
      const from = { x: this.x, y: this.y }, t0 = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        this.moveTo(from.x + dx * e, from.y + (y - from.y) * e);
        if (t < 1 && !this.dragging) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
  }

  save(patch) { store.set(this.opts.storageKey, { ...(store.get(this.opts.storageKey) ?? {}), ...patch }); }

  bindInput() {
    const b = this.body;
    let down = null, samples = [];
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      down = { px: e.clientX, py: e.clientY, ox: e.clientX - this.x, oy: e.clientY - this.y, t: performance.now() };
      samples = [];
      b.setPointerCapture(e.pointerId);
    });
    b.addEventListener("pointermove", (e) => {
      if (!down) return;
      if (!this.dragging && Math.hypot(e.clientX - down.px, e.clientY - down.py) > 5) this.startDrag();
      if (!this.dragging) return;
      const now = performance.now();
      samples.push({ x: e.clientX, t: now });
      samples = samples.filter((s) => now - s.t < 700);
      const prev = samples[samples.length - 2];
      const vx = prev ? (e.clientX - prev.x) / Math.max(1, now - prev.t) : 0;
      this.body.style.transform = this.reduced ? "" : `rotate(${Math.max(-24, Math.min(24, vx * 14))}deg)`;
      let flips = 0;
      for (let i = 2; i < samples.length; i++) {
        const a = samples[i - 1].x - samples[i - 2].x, c = samples[i].x - samples[i - 1].x;
        if (Math.abs(a) > 6 && Math.abs(c) > 6 && Math.sign(a) !== Math.sign(c)) flips++;
      }
      if (flips >= 4) this.shaken = true;
      this.moveTo(e.clientX - down.ox, e.clientY - down.oy);
    });
    const up = (e) => {
      if (!down) return;
      down = null;
      if (this.dragging) this.endDrag(e);
      else if (this.tucked) this.untuck();
      else this.pet();
    };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    b.addEventListener("dblclick", () => this.emit("open", {}));
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (this.tucked) this.untuck(); else this.pet(); }
      if (e.key === "Escape") { if (this.tucked) this.untuck(); else this.tuck(); }
    });
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); this.menu(); });
    this.bubble.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-i]");
      const item = this.bubbleItem;
      if (!item) return;
      if (btn) { const a = item.actions[Number(btn.dataset.i)]; item.resolve?.(a.value); this.emit("answer", { text: item.text, value: a.value }); this.closeBubble(); if (!this.activity) this.play("petted"); return; }
      if (!item.actions && !item.progress) this.closeBubble();
    });
    this.onDocMove = (e) => this.lookAt(e.clientX, e.clientY);
    addEventListener("pointermove", this.onDocMove, { passive: true });
    this.onResize = () => {
      if (this.dragging) return;
      if (this.tucked) this.moveTo(this.x, vh() - this.size * PEEK);
      else if (this.seat) this.sitOn(this.seat.el, this.seat);
      else this.placeDock();
    };
    addEventListener("scroll", this.onResize, { passive: true });
    addEventListener("resize", this.onResize);
    this.touch();
  }

  startDrag() {
    this.dragging = true;
    this.seat = null;
    this.shaken = false;
    this.root.classList.add("is-dragging");
    this.clearBubble();
    if (this.tucked) { this.tucked = null; this.root.classList.remove("is-tucked"); }
    clearTimeout(this.idleTimer);
    this.play("dangle", { loop: true });
  }

  async endDrag(e) {
    this.dragging = false;
    this.root.classList.remove("is-dragging");
    this.body.style.transform = "";
    this.touch();
    this.root.style.visibility = "hidden";
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-nori-drop]");
    this.root.style.visibility = "";
    await this.play("land", { loop: false, then: null });
    if (this.shaken) await this.play("dizzy");
    this.resumeBubbles();
    if (target) { this.emit("drop", { target, id: target.getAttribute("data-nori-drop") }); return; }
    const left = this.x + this.size / 2 < vw() / 2;
    const [x, y] = this.clamp(left ? 16 : vw() - this.size - 16, this.y);
    await this.walkTo(x, y);
    this.dock = { side: left ? "left" : "right", y };
    this.save({ pos: this.dock });
    this.backToRest();
  }

  async pet() {
    this.touch();
    if (this.row === "sleep") { this.clearFx("zzz"); this.activity = null; await this.play("wake"); this.rest(); return; }
    this.fx("hearts");
    const line = this.opts.onPet?.();
    if (line) this.say(line);
    this.emit("pet", {});
    await this.play("petted");
  }

  lookAt(cx, cy) {
    if (this.dragging || this.activity || this.tucked) return;
    if (this.row !== "idle" && this.row !== "look") return;
    const mx = this.x + this.size / 2, my = this.y + this.size / 2, dx = cx - mx, dy = cy - my, d = Math.hypot(dx, dy);
    if (d > 260 || d < this.size * 0.55) { if (this.row === "look") this.rest(); return; }
    const frame = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 1) : dy < 0 ? 2 : 3;
    if (this.row !== "look") {
      clearTimeout(this.frameTimer); clearTimeout(this.idleTimer);
      const row = this.manifest.rows.look;
      this.row = "look";
      this.sprite.style.backgroundImage = `url("${this.base}${row.src}")`;
      this.sprite.style.backgroundSize = `${row.frames * this.size}px ${this.size}px`;
    }
    this.showFrame(frame);
    clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => { if (this.row === "look") this.rest(); }, 2500);
  }

  menu() {
    const sizeKey = Object.keys(SIZES).find((k) => SIZES[k] === this.size);
    this.ask("Nori settings", [
      { label: this.muted ? "Unmute" : "Mute", value: "mute" },
      { label: sizeKey === "s" ? "Bigger" : sizeKey === "l" ? "Smaller" : "Bigger", value: "size" },
      { label: "Tuck away", value: "tuck" },
    ], { tone: "info" }).then((v) => {
      if (v === "mute") this.mute(!this.muted);
      if (v === "size") this.setSize(sizeKey === "l" ? "s" : sizeKey === "m" ? "l" : "m");
      if (v === "tuck") this.tuck();
    });
  }

  emit(name, detail) { for (const fn of this.listeners.get(name) ?? []) fn(detail); }

  // ---------- bubbles ----------

  enqueue(item) {
    return new Promise((resolve) => {
      item.resolve = resolve;
      this.history.push({ text: item.text, title: item.title, tone: item.tone, at: new Date().toISOString() });
      if (this.history.length > 100) this.history.shift();
      this.emit("say", item);
      if (this.muted && !item.actions) { resolve(undefined); return; }
      this.live.textContent = [item.title, item.text, item.actions ? `Answer in Nori's bubble: ${item.actions.map((a) => a.label).join(", ")}.` : ""].filter(Boolean).join(". ");
      // A question waits behind nothing and is never pushed out; anything else replaces a passing bubble.
      if (!this.bubbleItem || !this.bubbleItem.actions || item.actions) {
        if (this.bubbleItem?.actions && item.actions) { this.queue.push(item); return; }
        if (this.bubbleItem && !this.bubbleItem.actions && !this.bubbleItem.progress) this.bubbleItem.resolve?.(undefined);
        if (this.bubbleItem?.progress && !item.progress) this.queue.unshift(this.bubbleItem);
        this.showBubble(item);
      } else this.queue.push(item);
    });
  }

  showBubble(item) {
    clearTimeout(this.bubbleTimer);
    clearInterval(this.tickTimer);
    this.bubbleItem = item;
    this.renderBubble(item);
    this.bubble.hidden = false;
    this.bubble.classList.remove("is-in");
    void this.bubble.offsetWidth;
    this.bubble.classList.add("is-in");
    this.placeBubble();

    if (item.ms) this.bubbleTimer = setTimeout(() => this.closeBubble(), item.ms);
    if (item.progress) this.tickTimer = setInterval(() => this.renderBubble(item), 500);
  }

  renderBubble(item) {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const secs = item.progress ? Math.max(0, Math.round((Date.now() - item.startedAt) / 1000)) : 0;
    this.bubble.dataset.tone = item.tone;
    this.bubble.innerHTML = [
      item.title ? `<div class="nori-bubble-title">${esc(item.title)}${item.progress ? `<span class="nori-bubble-time">${secs}s</span>` : ""}</div>` : "",
      `<div class="nori-bubble-text">${esc(item.text)}</div>`,
      item.progress ? `<div class="nori-bubble-bar"><i style="width:${Math.max(4, Math.min(100, item.percent))}%"></i></div>` : "",
      item.actions ? `<div class="nori-bubble-actions">${item.actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : "",
    ].join("");
  }

  closeBubble() {
    clearTimeout(this.bubbleTimer);
    clearInterval(this.tickTimer);
    const done = this.bubbleItem;
    if (done && !done.actions) done.resolve?.(undefined);
    this.bubbleItem = null;
    this.bubble.classList.remove("is-in");
    this.bubble.hidden = true;
    const next = this.queue.shift();
    if (next) this.showBubble(next);
  }

  /** Shows the next waiting bubble (a question or progress put aside by a drag or tuck). */
  resumeBubbles() {
    if (!this.bubbleItem && this.queue.length && !this.tucked && !this.dragging) this.showBubble(this.queue.shift());
  }

  clearBubble() {
    clearTimeout(this.bubbleTimer);
    clearInterval(this.tickTimer);
    if (this.bubbleItem?.actions || this.bubbleItem?.progress) this.queue.unshift(this.bubbleItem);
    else this.bubbleItem?.resolve?.(undefined);
    this.bubbleItem = null;
    this.bubble.hidden = true;
  }

  /** Bubble sits above the highest point of the current row; below Nori near the top of the screen; never off-screen. */
  placeBubble() {
    if (!this.bubble || this.bubble.hidden) return;
    const row = this.manifest.rows[this.row];
    const k = this.size / this.manifest.cell;
    const top = row ? Math.min(...row.anchors.top.map((t) => t[1])) * k : 0;
    const h = this.bubble.offsetHeight, w = this.bubble.offsetWidth;
    const below = this.y + top - h - 14 < 4;
    this.bubble.classList.toggle("is-below", below);
    this.bubble.style.top = below ? `${this.size + 10}px` : `${top - h - 12}px`;
    const centre = this.x + this.size / 2;
    const left = centre - w / 2;
    const shift = left < 8 ? 8 - left : left + w > vw() - 8 ? vw() - 8 - (left + w) : 0;
    this.bubble.style.setProperty("--shift", `${shift}px`);
  }

  // ---------- effects ----------

  fx(name) {
    if (this.reduced && name !== "alert" && name !== "zzz") return;
    const layer = this.fxLayer;
    const add = (html, cls, life) => {
      const el = document.createElement("span");
      el.className = `nori-fx-${cls}`;
      el.innerHTML = html;
      layer.appendChild(el);
      if (life) setTimeout(() => el.remove(), life);
      return el;
    };
    if (name === "hearts") for (let i = 0; i < 3; i++) add(svg(HEART, "nori-heart"), "rise", 1400).style.cssText = `--dx:${(i - 1) * 22}px;--delay:${i * 120}ms`;
    if (name === "sparkles") for (let i = 0; i < 5; i++) add(svg(STAR, "nori-star"), "pop", 1100).style.cssText = `--a:${i * 72 - 90}deg;--delay:${i * 60}ms`;
    if (name === "confetti") for (let i = 0; i < 18; i++) add("", "confetti", 1800).style.cssText = `--a:${Math.random() * 360}deg;--r:${50 + Math.random() * 60}px;--hue:${[45, 150, 340, 260, 15][i % 5]};--delay:${Math.random() * 150}ms`;
    if (name === "zzz" && !layer.querySelector(".nori-fx-zzz")) add("<b>z</b><b>z</b><b>z</b>", "zzz");
    if (name === "alert" && !layer.querySelector(".nori-fx-alert")) add("!", "alert");
  }

  clearFx(name) { this.fxLayer.querySelectorAll(`.nori-fx-${name}`).forEach((el) => el.remove()); }
}

export default NoriPet;
