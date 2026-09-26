/** How wide the outline column is; the grip sits against its edge. */
export const OUTLINE_WIDTH = 228;

/**
 * The one way to hide or show the outline.
 *
 * A labelled button in a corner would be a second thing to notice, and the
 * panel's own outline carries a hide button of its own - two controls for one
 * state. Here there is exactly one: a slim grip on the boundary between the
 * article and its headings. It takes almost no room, widens under the pointer,
 * and a click toggles.
 *
 * The panel's list grip (PanelHandle in App.tsx) is the same shape, because
 * both answer the same question: how do I get this column back?
 */
export function OutlineHandle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? '隐藏大纲' : '显示大纲';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={open}
      data-outline-handle
      onClick={onToggle}
      // On the boundary: against the outline's own edge while it is open,
      // against the page's when it is closed.
      style={{ right: open ? OUTLINE_WIDTH : 0 }}
      className="glass focus-ring absolute top-1/2 z-20 flex h-14 w-2.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-full shadow-strong transition-[width,background-color] duration-200 hover:w-4"
    >
      <span className="h-6 w-[2px] rounded-full bg-[color-mix(in_srgb,var(--text)_30%,transparent)]" />
    </button>
  );
}
