/** Words for a slide transition in presentation mode ("wipe right"), or null for a plain cut (pure). */
export function transitionLabel(t: { effect: string; direction?: string } | null): string | null {
  if (!t || t.effect === "replace") return null;
  return t.direction ? `${t.effect} ${t.direction}` : t.effect;
}
