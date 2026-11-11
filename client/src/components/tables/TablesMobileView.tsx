import { Fragment, useState } from "react";
import { Users, Printer, ArrowRightLeft, Edit2, Trash2, Plus, Pencil, UtensilsCrossed, Bike, ShoppingBag } from "lucide-react";
import { LiveOrdersStrip } from "@/components/live-tables/LiveOrdersPanel";
import { SectionOrdersFlyout } from "@/components/live-tables/SectionOrdersFlyout";
import type { LiveOrder } from "@/hooks/useLiveOrders";
import { filterTablesByStatus, floorStaffChips, type TableStatusFilter } from "@/lib/tablesMobile";
import {
  type Table, type TableStatus, statusConfig, fmt, RunningTimer, TableTimer, sectionLabel,
} from "./tableShared";

export interface LiveStatusSummary {
  runningTables: number; freeTables: number; activeOrders: number;
  todaySales: number; cashSales: number; upiSales: number; dueAmount?: number;
}

interface Props {
  tables: Table[];
  isLoading: boolean;
  grouped: Record<string, Table[]>;
  sectionOrder: string[];
  liveStatus?: LiveStatusSummary;
  showSalesSplit: boolean;
  onToggleSalesSplit: () => void;
  salesRef: React.RefObject<HTMLButtonElement>;
  shiftFrom: Table | null;
  deliveryOrders: LiveOrder[];
  pickupOrders: LiveOrder[];
  posSections: Array<{ id: string; name: string }>;
  sectionOrders: Record<string, LiveOrder[]>;
  onTableClick: (t: Table) => void;
  onPrint: (orderId: number) => void;
  onMove: (t: Table) => void;
  onEdit: (e: React.MouseEvent, t: Table) => void;
  onDelete: (e: React.MouseEvent, t: Table) => void;
  onAddTable: () => void;
  onDelivery: () => void;
  onPickup: () => void;
  onSectionNewOrder: (s: { id: string; name: string }) => void;
}

/** Compact phone layout of the Tables page (Compact POS design). Presentational only:
 *  every action is a callback into Tables.tsx, which keeps the mutations, PIN gates and dialogs. */
export function TablesMobileView(p: Props) {
  const [filter, setFilter] = useState<TableStatusFilter>(null);
  const [editMode, setEditMode] = useState(false);

  const running = p.liveStatus?.runningTables ?? p.tables.filter(t => t.status === "running").length;
  const free = p.liveStatus?.freeTables ?? p.tables.filter(t => t.status === "free").length;
  const chips = floorStaffChips(p.tables);
  const activeCount = p.tables.filter(t => t.status === "running").length;

  const stats: Array<{ key: string; label: string; value: string | number; dot: string; filter?: TableStatusFilter }> = [
    { key: "running", label: "Running", value: running, dot: "var(--green-500)", filter: "running" },
    { key: "free", label: "Free", value: free, dot: "var(--text-3)", filter: "free" },
    { key: "orders", label: "Orders", value: p.liveStatus?.activeOrders ?? 0, dot: "var(--ink-700)" },
    { key: "sales", label: "Sales", value: fmt(p.liveStatus?.todaySales ?? 0), dot: "#D89A3E" },
  ];

  const dueAmount = p.liveStatus?.dueAmount ?? 0;
  const salesSegments = [
    { key: "cash", label: "Cash", amount: p.liveStatus?.cashSales ?? 0, dot: "bg-emerald-500", text: "text-emerald-800" },
    { key: "upi", label: "UPI", amount: p.liveStatus?.upiSales ?? 0, dot: "bg-indigo-500", text: "text-indigo-800" },
    ...(Math.round(dueAmount) > 0
      ? [{ key: "due", label: "Due", amount: dueAmount, dot: "bg-amber-500", text: "text-amber-800" }]
      : []),
  ];

  const renderTable = (table: Table) => {
    const status = (table.status in statusConfig ? table.status : "free") as TableStatus;
    const cfg = statusConfig[status];
    const occupied = status !== "free";
    const isShiftSource = p.shiftFrom?.id === table.id;
    const isShiftTarget = !!p.shiftFrom && p.shiftFrom.id !== table.id && status === "free";
    const showRunActions = status === "running" && !!table.currentOrderId && !editMode;
    return (
      <div
        key={table.id}
        className={`relative h-[60px] rounded-xl flex items-stretch overflow-hidden ${occupied ? "col-span-2" : ""} ${isShiftTarget ? "ring-2 ring-amber-400 ring-offset-1" : ""} ${isShiftSource ? "ring-2 ring-primary ring-offset-1" : ""}`}
        style={cfg.style}
      >
        <button
          type="button"
          onClick={e => (editMode ? p.onEdit(e, table) : p.onTableClick(table))}
          className="flex-1 min-w-0 flex flex-col justify-center gap-[3px] px-[9px] py-[7px] text-left"
        >
          <span className="flex items-baseline gap-1.5 min-w-0">
            <b className={`text-base font-extrabold leading-none truncate ${cfg.nameText}`}>{table.name}</b>
            {status === "running" && (
              <span className="font-mono text-[10px] font-bold shrink-0" style={{ color: "var(--green-700)" }}>
                {table.orderCreatedAt
                  ? <RunningTimer startedAt={table.orderCreatedAt} />
                  : table.currentOrderId ? <TableTimer orderId={table.currentOrderId} /> : "Active"}
              </span>
            )}
          </span>
          {status === "free" && (
            <span className={`flex items-center gap-[3px] font-mono text-[10px] ${cfg.subText}`}>
              <Users className="w-2.5 h-2.5" />{table.capacity}
            </span>
          )}
          {status === "running" && (
            <span className="text-xs font-extrabold tabular-nums whitespace-nowrap truncate" style={{ color: "var(--green-800)" }}>
              {table.runningTotal != null ? fmt(table.runningTotal) : ""}
              {table.servedByName && (
                <span className="ml-1 font-mono text-[10px] font-bold" style={{ color: "var(--ink-700)" }}>{table.servedByName}</span>
              )}
            </span>
          )}
          {status === "billed" && (
            <span className={`text-[11px] font-semibold truncate ${cfg.subText}`}>
              Bill printed{table.runningTotal != null ? ` · ${fmt(table.runningTotal)}` : ""}
            </span>
          )}
        </button>

        {showRunActions && (
          <div className="flex items-center gap-1 pr-[7px]">
            <button
              type="button"
              aria-label={`Print bill for ${table.name}`}
              onClick={e => { e.stopPropagation(); p.onPrint(table.currentOrderId!); }}
              className="w-[38px] h-11 rounded-[10px] flex items-center justify-center text-white"
              style={{ background: "var(--green-800)" }}
            >
              <Printer className="w-[15px] h-[15px]" />
            </button>
            <button
              type="button"
              aria-label={`Move ${table.name}`}
              onClick={e => { e.stopPropagation(); p.onMove(table); }}
              className="w-[38px] h-11 rounded-[10px] flex items-center justify-center bg-white"
              style={{ border: "1px solid var(--green-200)", color: "var(--green-700)" }}
            >
              <ArrowRightLeft className="w-[15px] h-[15px]" />
            </button>
          </div>
        )}

        {editMode && (
          <>
            <button
              type="button"
              aria-label={`Delete ${table.name}`}
              onClick={e => p.onDelete(e, table)}
              className="absolute top-0 right-0 w-[30px] h-[30px] rounded-bl-[10px] flex items-center justify-center"
              style={{ background: "var(--danger-bg)", color: "var(--danger)" }}
            >
              <Trash2 className="w-[13px] h-[13px]" />
            </button>
            <button
              type="button"
              aria-label={`Edit ${table.name}`}
              onClick={e => p.onEdit(e, table)}
              className="absolute bottom-0 right-0 w-[30px] h-[30px] rounded-tl-[10px] flex items-center justify-center"
              style={{ background: "var(--info-bg)", color: "var(--ink-700)" }}
            >
              <Edit2 className="w-[13px] h-[13px]" />
            </button>
          </>
        )}
      </div>
    );
  };

  const zoneHeader = (name: string, meta: string) => (
    <div className="flex items-center gap-2.5 pt-3 pb-[7px]">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: "var(--text-1)" }}>{name}</span>
      <span className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-[10.5px]" style={{ color: "var(--text-2)" }}>{meta}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--paper-50)" }}>
      {/* Stats strip */}
      <div className="shrink-0 pt-2 px-3">
        <div className="grid grid-cols-4 rounded-[14px] overflow-hidden bg-white" style={{ border: "1px solid var(--line)" }}>
          {stats.map((s, i) => {
            const active = !!s.filter && filter === s.filter;
            const body = (
              <>
                <span className="flex items-center gap-[5px] text-[10px] font-extrabold uppercase tracking-[0.06em]" style={{ color: "var(--text-2)" }}>
                  <i className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
                </span>
                <span className="text-[15px] font-extrabold tabular-nums truncate max-w-full" style={{ color: "var(--text-strong)" }}>{s.value}</span>
              </>
            );
            const cls = `flex flex-col items-start gap-0.5 px-2.5 py-2 min-w-0 text-left ${i < 3 ? "border-r" : ""}`;
            const style = { borderColor: "#F0EADC", background: active || (s.key === "sales" && p.showSalesSplit) ? "var(--success-bg)" : "#fff" };
            if (s.key === "sales") {
              return (
                <button key={s.key} ref={p.salesRef} type="button" aria-expanded={p.showSalesSplit}
                  onClick={p.onToggleSalesSplit} className={cls} style={style}>{body}</button>
              );
            }
            if (s.filter) {
              return (
                <button key={s.key} type="button" aria-pressed={active}
                  onClick={() => setFilter(active ? null : s.filter!)} className={cls} style={style}>{body}</button>
              );
            }
            return <div key={s.key} className={cls} style={style}>{body}</div>;
          })}
        </div>

        {p.showSalesSplit && (
          <div className="grid grid-flow-col auto-cols-fr mt-1.5 rounded-xl overflow-hidden bg-white" style={{ border: "1px solid var(--line)" }}>
            {salesSegments.map((seg, i) => (
              <span key={seg.key} className={`flex items-center justify-center gap-1.5 py-2 min-w-0 ${i > 0 ? "border-l" : ""}`} style={{ borderColor: "#F0EADC" }}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${seg.dot}`} />
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-2)" }}>{seg.label}</span>
                <span className={`text-xs font-bold tabular-nums ${seg.text}`}>{fmt(seg.amount)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="shrink-0 flex gap-1.5 px-3 pt-2">
        <button type="button" onClick={p.onDelivery}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[12.5px] font-bold"
          style={{ background: "var(--ink-700)", color: "#EAF0F8" }}>
          <Bike className="w-[15px] h-[15px]" />Delivery
        </button>
        <button type="button" onClick={p.onPickup}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[12.5px] font-bold text-white"
          style={{ background: "var(--clay-600)" }}>
          <ShoppingBag className="w-[15px] h-[15px]" />Pickup
        </button>
        <button type="button" onClick={p.onAddTable}
          className="flex-1 h-11 rounded-xl flex items-center justify-center gap-1 text-[12.5px] font-bold bg-white"
          style={{ border: "1px dashed var(--line-strong)", color: "var(--text-1)" }}>
          <Plus className="w-[15px] h-[15px]" />Table
        </button>
        <button type="button" aria-label={editMode ? "Done editing tables" : "Edit tables"} aria-pressed={editMode}
          onClick={() => setEditMode(v => !v)}
          className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
          style={editMode
            ? { background: "var(--green-800)", color: "#F4F8F0", border: "1px solid var(--green-800)" }
            : { background: "#fff", color: "var(--text-1)", border: "1px solid var(--line)" }}>
          <Pencil className="w-4 h-4" />
        </button>
      </div>

      {/* On floor */}
      {chips.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-0.5 overflow-x-auto scrollbar-hide">
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.1em]" style={{ color: "var(--text-2)" }}>On floor</span>
          {chips.map(c => (
            <span key={c.name} className="shrink-0 inline-flex items-center h-6 px-[9px] rounded-full font-mono text-[10.5px] font-bold"
              style={{ background: "var(--info-bg)", color: "var(--ink-700)" }}>
              {c.name} → {c.tables.join(", ")}
            </span>
          ))}
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-2)" }}>
            {activeCount} {activeCount === 1 ? "table" : "tables"} active
          </span>
        </div>
      )}

      {/* Grid */}
      <main className="flex-1 min-h-0 overflow-y-auto px-3 pb-3.5">
        <div className="pt-2"><LiveOrdersStrip deliveryOrders={p.deliveryOrders} pickupOrders={p.pickupOrders} /></div>

        {p.isLoading ? (
          <div className="grid grid-cols-4 gap-1.5 pt-3">
            {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-[60px] skeleton-glass" />)}
          </div>
        ) : p.tables.length === 0 ? (
          <div className="flex flex-col items-center text-center py-16">
            <Users className="w-8 h-8 mb-3" style={{ color: "var(--text-3)" }} />
            <p className="text-base font-semibold mb-1">No tables yet</p>
            <button type="button" onClick={p.onAddTable} className="mt-2 h-11 px-4 rounded-xl text-sm font-bold text-white" style={{ background: "var(--green-800)" }}>
              Add first table
            </button>
          </div>
        ) : (
          p.sectionOrder.map(section => {
            const all = p.grouped[section];
            const visible = filterTablesByStatus(all, filter);
            if (visible.length === 0) return null;
            return (
              <Fragment key={section}>
                {zoneHeader(sectionLabel(section), `${all.filter(t => t.status === "running").length} running · ${all.length} tables`)}
                <div className="grid grid-cols-4 gap-1.5">{visible.map(renderTable)}</div>
              </Fragment>
            );
          })
        )}

        {p.posSections.map(section => {
          const open = p.sectionOrders[section.id] ?? [];
          return (
            <Fragment key={section.id}>
              {zoneHeader(section.name, `${open.length} open`)}
              <div className="grid grid-cols-4 gap-1.5">
                <div className="col-span-2">
                  <SectionOrdersFlyout sectionId={section.id} sectionName={section.name} orders={open}
                    onNewOrder={() => p.onSectionNewOrder(section)}>
                    <div className="h-[60px] rounded-xl flex items-center gap-2 px-3 border-2 border-amber-400 bg-amber-50">
                      <UtensilsCrossed className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-amber-700 truncate">{section.name}</span>
                        <span className="block text-[10px] font-medium text-amber-500">Tap to order</span>
                      </span>
                    </div>
                  </SectionOrdersFlyout>
                </div>
              </div>
            </Fragment>
          );
        })}
      </main>
    </div>
  );
}
