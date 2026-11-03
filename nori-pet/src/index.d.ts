export type NoriEvent =
  | "hello" | "shortlist-ready" | "preparing" | "prepared" | "applying" | "submitting" | "awaiting-code" | "code"
  | "submitted" | "needs-user" | "captcha" | "failed" | "reply" | "interview" | "offer" | "rejection" | "cap-reached" | "idle"
  | "password" | "password-show" | "password-hide" | "password-done" | "signing-in" | "signed-in" | "auth-failed"
  | "email-sent" | "welcome" | "loading"
  | "scroll-cue" | "searching" | "speed" | "relaxing" | "thanks";

export type NoriTone = "info" | "alert" | "success" | "error";
export type NoriSize = "s" | "m" | "l";

export interface NoriAction<T = unknown> { label: string; value: T }

export interface NoriRow {
  src: string;
  set: "app" | "auth" | "landing";
  label: string;
  plays: string;
  frames: number;
  ms: number[];
  loop: boolean;
  anchors: { top: [number, number][]; note: ([number, number] | null)[] };
}

export interface NoriManifest { version: number; cell: number; ground: number; rows: Record<string, NoriRow> }

export interface NoriOptions {
  /** URL of the assets folder holding nori.json and rows/ (defaults to the package's own assets). */
  assets?: string;
  manifest?: NoriManifest;
  size?: NoriSize;
  parent?: HTMLElement;
  sleepAfterMs?: number;
  blinkEveryMs?: [number, number];
  storageKey?: string;
  reducedMotion?: boolean;
  /** Line Nori says when petted (today's summary, for example). */
  onPet?: () => string | null | undefined;
}

export interface NoriProgress { title?: string; step?: string; percent?: number; startedAt?: number }

export interface NoriHistoryEntry { text: string; title?: string; tone: NoriTone; at: string }

export declare const REACTIONS: Record<NoriEvent, { row: string; loop?: boolean; then?: string; end?: boolean; fx?: string; tone?: NoriTone; untuck?: boolean }>;

export declare class NoriPet {
  static create(options?: NoriOptions): Promise<NoriPet>;
  readonly history: NoriHistoryEntry[];
  readonly manifest: NoriManifest;
  /** The row on screen now, and the ongoing loop (null when resting). */
  readonly row: string;
  readonly activity: string | null;
  readonly muted: boolean;
  readonly tucked: { x: number; y: number } | null;
  readonly size: number;
  play(row: string, options?: { loop?: boolean; then?: string }): Promise<void>;
  react<T = unknown>(event: NoriEvent | string, options?: { say?: string; note?: string | null; tone?: NoriTone; ms?: number; actions?: NoriAction<T>[] }): Promise<T | void>;
  say(text: string, options?: { tone?: NoriTone; ms?: number; title?: string }): Promise<void>;
  ask<T = unknown>(text: string, actions: NoriAction<T>[], options?: { tone?: NoriTone; title?: string }): Promise<T>;
  progress(progress: NoriProgress): void;
  progressDone(text: string, options?: { tone?: NoriTone }): Promise<void>;
  /** Closes the bubble on screen (a question resolves only through its buttons) and shows the next one. */
  closeBubble(): void;
  setNote(text: string | null): void;
  /** Eyes follow a caret: 0 is the field's left end, 1 its right end; null stops. */
  follow(fraction: number | null): void;
  /** Wires a sign-in or sign-up form (read along, cover eyes, peek when shown); returns an unwire function. */
  watchFields(fields: { text?: HTMLInputElement[]; password?: HTMLInputElement; reveal?: HTMLElement }): () => void;
  /** Sits Nori on top of an element, following scroll and resize; null sends it back to its dock. */
  sitOn(element: Element | null, options?: { overlap?: number; align?: "left" | "center" | "right" }): void;
  pointAt(element: Element, say?: string): Promise<void>;
  walkTo(x: number, y?: number): Promise<void>;
  tuck(): void;
  untuck(): void;
  setSize(size: NoriSize): void;
  mute(on?: boolean): void;
  fx(name: "hearts" | "sparkles" | "confetti" | "zzz" | "alert"): void;
  on(event: "drop", fn: (detail: { target: Element; id: string | null }) => void): () => void;
  on(event: "open" | "pet", fn: (detail: Record<string, never>) => void): () => void;
  on(event: "answer", fn: (detail: { text: string; value: unknown }) => void): () => void;
  on(event: "say", fn: (detail: { text: string; tone: NoriTone }) => void): () => void;
  destroy(): void;
}

export default NoriPet;
