/** Pure helpers for the compact mobile POS (cart totals handle + Settle button). */

export function settleButtonLabel(a: {
  phase: string; busy: boolean; total: number; lines: number; fmt: (n: number) => string;
}): string {
  if (a.phase === "printing") return "Printing…";
  if (a.busy || a.phase === "processing") return "…";
  if (a.lines <= 0) return "Settle";
  return `Settle ${a.fmt(a.total)} · ${a.lines} ${a.lines === 1 ? "item" : "items"}`;
}

export function cartTotalsHint(a: { open: boolean; subtotal: number; tax: number; fmt: (n: number) => string }): string {
  return a.open ? "Bill details" : `Subtotal ${a.fmt(a.subtotal)} · tax ${a.fmt(a.tax)} · discount & charges`;
}
