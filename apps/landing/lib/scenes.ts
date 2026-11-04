import data from "./scenes.json";

/** The painted scenes built by `npm run art:build` (spec section 8). */
export const scenes = data;
export type SceneId = keyof typeof data;
export type SceneData = (typeof data)[SceneId];

/** The `srcset` value for one format of a scene. */
export function srcSet(scene: SceneData, format: "avif" | "webp") {
  return scene.sources.map((s) => `${s[format]} ${s.width}w`).join(", ");
}
