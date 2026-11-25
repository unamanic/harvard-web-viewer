/** Words for a slide transition in presentation mode ("wipe right"), or null for a plain cut (pure). */
export function transitionLabel(t: { effect: string; direction?: string } | null): string | null {
  if (!t || t.effect === "replace") return null;
  return t.direction ? `${t.effect} ${t.direction}` : t.effect;
}

/**
 * Words for a whole slide change: the old slide's erase (if animated or not
 * a plain cut), then the new slide's draw ("erase fade, then iris out"), or
 * null when both are plain cuts (pure).
 */
export function transitionPlanLabel(
  plan: { erase: { effect: string; direction?: string } | null; draw: { effect: string; direction?: string } } | null,
): string | null {
  if (!plan) return null;
  const erase = transitionLabel(plan.erase);
  const draw = transitionLabel(plan.draw);
  if (erase && draw) return `erase ${erase}, then ${draw}`;
  return erase ? `erase ${erase}` : draw;
}
