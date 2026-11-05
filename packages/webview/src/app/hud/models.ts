const FAMILIES = ["fable", "opus", "sonnet", "haiku"];

/** The family a model belongs to: its name's family word, or the provider of `provider/model`. */
export function familyOf(model: string): string {
  const lower = model.toLowerCase();
  const word = FAMILIES.find((family) => lower.includes(family));
  if (word) return word[0]!.toUpperCase() + word.slice(1);
  const slash = model.indexOf("/");
  if (slash > 0) return model.slice(0, slash);
  return "Other";
}

/** Models in families, in the order the families first appear, aliases before ids. */
export function grouped(models: readonly string[]): { family: string; models: string[] }[] {
  const out: { family: string; models: string[] }[] = [];
  for (const model of models) {
    const family = familyOf(model);
    const held = out.find((group) => group.family === family);
    if (held) held.models.push(model);
    else out.push({ family, models: [model] });
  }
  for (const group of out) {
    group.models.sort((a, b) => Number(a.includes("-") || a.includes("/")) - Number(b.includes("-") || b.includes("/")));
  }
  return out;
}

/**
 * The name to show for a choice, with the model it actually lands on: the
 * default and an alias say which model answered, a full id is its own answer.
 */
export function shownAs(choice: string, inUse: string | undefined): string {
  const name = choice || "Default";
  if (!inUse || inUse === choice) return name;
  if (!choice) return `${name} · ${inUse}`;
  if (inUse.toLowerCase().includes(choice.toLowerCase())) return `${name} · ${inUse}`;
  return name;
}
