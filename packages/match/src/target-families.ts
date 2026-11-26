import { roleFamilyOf } from "./roles.js";

/**
 * The role families board discovery counts when it scores a board (packages/ingest/src/discovery/verify.ts): AI/ML,
 * data, product, software engineering and product/UX design. Title only, so it works on a feed read before anything
 * is stored.
 */
export const TARGET_FAMILIES = ["ai_ml", "data", "product", "software", "design"] as const;
export type TargetFamily = (typeof TARGET_FAMILIES)[number];

const ML = /\b(?:machine learning|ml|ai|nlp|llm|llms|computer vision|deep learning|mlops|genai|generative ai|reinforcement learning|research scientist|applied scientist)\b/;

/** The target family of a job title, or null when it is outside them (sales, finance, healthcare, graphic design...). */
export function targetFamilyOf(title: string): TargetFamily | null {
  const c = roleFamilyOf(title);
  const ml = ML.test(title.toLowerCase());
  switch (c.family) {
    case "software_engineering": return c.subfamily === "data_ml" ? (ml ? "ai_ml" : "data") : "software";
    case "data_analysis": return ml ? "ai_ml" : "data";
    case "product": return "product";
    case "design": return c.specialty === "ux" || c.specialty === "general" ? "design" : null;
    default: return null;
  }
}
