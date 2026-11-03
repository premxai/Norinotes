/**
 * Form recipe cache (table `form_recipes`). One row per form fingerprint, shared by every user: which profile slot each
 * question maps to and which widget strategy filled it. Never an applicant's value: the stored shape has no value field,
 * and `saveRecipe` drops anything else.
 */
import type { Slot } from "@norinote/answers";
import { eq, formRecipes, sql, type Db } from "@norinote/db";

/** How a field is filled. Role- and text-based, never a generated element id. */
export type WidgetStrategy = "text" | "native-select" | "combobox" | "radio-label" | "checkbox-label" | "checkbox" | "yesno" | "file" | "location" | "phone-country";

export type RecipeField = {
  /** Normalised label: the question this entry is about. */
  labelKey: string;
  label: string;
  type: string;
  slot: Slot;
  strategy?: WidgetStrategy;
};

export type FormRecipe = {
  fingerprint: string;
  ats: string;
  companyToken: string;
  fields: RecipeField[];
  version: number;
  hits: number;
  heals: number;
};

const toRecipe = (r: typeof formRecipes.$inferSelect): FormRecipe => ({
  fingerprint: r.fingerprint, ats: r.atsType, companyToken: r.companyToken, fields: (r.fields as RecipeField[]) ?? [],
  version: r.version, hits: r.hits, heals: r.heals,
});

export async function loadRecipe(db: Db, fingerprint: string): Promise<FormRecipe | null> {
  const [row] = await db.select().from(formRecipes).where(eq(formRecipes.fingerprint, fingerprint)).limit(1);
  return row ? toRecipe(row) : null;
}

/** Only the allowed keys survive, so a value can never be written into the shared cache by mistake. */
const scrub = (f: RecipeField): RecipeField => ({
  labelKey: String(f.labelKey).slice(0, 300), label: String(f.label).slice(0, 300), type: String(f.type), slot: f.slot,
  ...(f.strategy ? { strategy: f.strategy } : {}),
});

/** Insert or replace the recipe for a fingerprint (merging field entries by label). */
export async function saveRecipe(db: Db, recipe: Pick<FormRecipe, "fingerprint" | "ats" | "companyToken" | "fields">, opts: { healed?: boolean } = {}): Promise<void> {
  const existing = await loadRecipe(db, recipe.fingerprint);
  const k = (f: RecipeField) => `${f.labelKey}|${f.type}`;
  const merged = new Map<string, RecipeField>((existing?.fields ?? []).map((f) => [k(f), f]));
  for (const f of recipe.fields) merged.set(k(f), { ...merged.get(k(f)), ...scrub(f) });
  const fields = [...merged.values()].map(scrub);
  const now = new Date();
  await db.insert(formRecipes).values({ fingerprint: recipe.fingerprint, atsType: recipe.ats, companyToken: recipe.companyToken, fields, lastUsedAt: now })
    .onConflictDoUpdate({
      target: formRecipes.fingerprint,
      set: { fields, updatedAt: now, lastUsedAt: now, version: sql`${formRecipes.version} + 1`, ...(opts.healed ? { heals: sql`${formRecipes.heals} + 1` } : {}) },
    });
}

/** Count a cache hit. */
export async function touchRecipe(db: Db, fingerprint: string): Promise<void> {
  await db.update(formRecipes).set({ hits: sql`${formRecipes.hits} + 1`, lastUsedAt: new Date() }).where(eq(formRecipes.fingerprint, fingerprint));
}

/** Remember the widget strategies that worked at fill time, by label. */
export async function recordStrategies(db: Db, fingerprint: string, strategies: Record<string, WidgetStrategy>, healed: boolean): Promise<void> {
  const existing = await loadRecipe(db, fingerprint);
  if (!existing) return;
  const fields = existing.fields.map((f) => (strategies[f.labelKey] ? { ...f, strategy: strategies[f.labelKey] } : f));
  await saveRecipe(db, { ...existing, fields }, { healed });
}

/** The normalised label recipes and strategies are keyed by. */
export const labelKey = (s: string): string => s.toLowerCase().replace(/[’`']/g, "").replace(/[^\p{L}\p{N}+#]+/gu, " ").trim();
