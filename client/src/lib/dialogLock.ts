/**
 * Props to spread onto a shadcn/Radix <DialogContent> while a PIN pad (<PinGuard>) is stacked on top of it.
 *
 * PinGuard is a plain portal on <body>, not a Radix layer, so the dialog underneath treats everything the
 * user does on the pad as an interaction OUTSIDE itself. Left alone, that means:
 *   • the first tap on a digit (a pointer-down outside) closes the dialog and throws away what was typed;
 *   • Escape, meant for the pad, also closes the dialog — and the pad's own Escape handler (cancel) fires too;
 *   • Radix's focus trap yanks focus back into the dialog after every tap, and since it re-focuses the last
 *     control (the amount / reason box, with its text selected), digits typed on a physical keyboard land in
 *     that box AS WELL AS in the PIN.
 *
 * So while `locked`: outside interactions and Escape are swallowed, and the content is `inert` — nothing in
 * it can take focus or a click, so the trap has nowhere to pull focus back to. (`inert` is not in React 18's
 * typings, hence the loose return type; React passes the attribute straight through to the DOM.)
 */
export function lockedDialogProps(locked: boolean): Record<string, unknown> {
  if (!locked) return {};
  const swallow = (e: Event) => e.preventDefault();
  return { onInteractOutside: swallow, onEscapeKeyDown: swallow, inert: "" };
}
