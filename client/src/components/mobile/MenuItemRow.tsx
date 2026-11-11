import { Edit, Trash2, CheckSquare, Square } from "lucide-react";

/** Phone list row for a menu item (MobilePOS "Menu manage" style). Presentational only. */
export function MenuItemRow({
  name, meta, available, bulkMode, selected, deleting, onToggleSelect, onEdit, onDelete,
}: {
  name: string;
  /** Mono line under the name: "Category · ₹199 · Prep 15min · Margin 42%". */
  meta: string;
  available: boolean;
  bulkMode: boolean;
  selected: boolean;
  deleting: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={bulkMode ? onToggleSelect : undefined}
      className={`flex items-center gap-2.5 pl-3 pr-1 py-2 min-h-[60px] border-b ${selected ? "bg-emerald-50" : "bg-white"} ${bulkMode ? "cursor-pointer" : ""}`}
      style={{ borderColor: "#F0EADC" }}
    >
      {bulkMode && (selected
        ? <CheckSquare className="w-5 h-5 text-emerald-600 shrink-0" />
        : <Square className="w-5 h-5 text-gray-300 shrink-0" />)}
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-bold leading-tight" style={{ color: available ? "var(--text-strong)" : "var(--text-3)" }}>{name}</div>
        <div className="font-mono text-[11px] mt-1 leading-snug" style={{ color: "var(--text-3)" }}>{meta}</div>
      </div>
      <span
        className="shrink-0 h-[26px] px-2.5 rounded-full inline-flex items-center text-[10.5px] font-extrabold uppercase tracking-wide"
        style={available
          ? { background: "var(--success-bg)", color: "var(--green-700)" }
          : { background: "var(--danger-bg)", color: "var(--danger)" }}
      >
        {available ? "In stock" : "Out"}
      </span>
      {!bulkMode && (
        <>
          <button type="button" aria-label={`Edit ${name}`} onClick={onEdit}
            className="shrink-0 w-11 h-11 flex items-center justify-center" style={{ color: "var(--text-2)" }}>
            <Edit className="w-4 h-4" />
          </button>
          <button type="button" aria-label={`Delete ${name}`} disabled={deleting} onClick={onDelete}
            className="shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-40" style={{ color: "var(--danger)" }}>
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
