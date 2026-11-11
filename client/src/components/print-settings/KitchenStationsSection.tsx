import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { KitchenStationsSettings, SkipKotSettings } from "@shared/print/types";

interface CategoryLite { id: number; name: string; isActive?: boolean }
interface MenuItemLite { id: number; name: string; categoryId: number | null }

const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

export const DEFAULT_STATIONS: KitchenStationsSettings = { enabled: false, stations: [], generalName: "General" };
export const DEFAULT_SKIP: SkipKotSettings = { categoryIds: [], itemIds: [] };

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-600 font-medium bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span>{title}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-3 py-3 space-y-3">{children}</div>}
    </div>
  );
}

/** One KOT ticket per chef: each station = the categories that chef cooks. */
export function KitchenStationsSection({ value, onChange }: {
  value: KitchenStationsSettings | undefined;
  onChange: (next: KitchenStationsSettings) => void;
}) {
  const cfg = value ?? DEFAULT_STATIONS;
  const { data: categories = [] } = useQuery<CategoryLite[]>({ queryKey: ["/api/categories"] });
  const active = categories.filter(c => c.isActive !== false);
  const set = (patch: Partial<KitchenStationsSettings>) => onChange({ ...cfg, ...patch });
  const setStation = (id: string, patch: Partial<KitchenStationsSettings["stations"][number]>) =>
    set({ stations: cfg.stations.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (idx: number, dir: -1 | 1) => {
    const next = cfg.stations.slice();
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    set({ stations: next });
  };
  const ownerOf = (catId: number) => cfg.stations.find(s => s.categoryIds.indexOf(catId) >= 0);
  const summary = cfg.enabled ? ` · ${cfg.stations.length} station${cfg.stations.length === 1 ? "" : "s"}` : " · off";

  return (
    <Collapsible title={`Kitchen Stations${summary}`}>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        One KOT per chef. Tick the categories each chef cooks — they all print on that chef's ticket, with the
        chef's station name in big letters on top. The printer cuts between tickets. Categories not ticked print
        on the General ticket.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-800">Split KOT by kitchen station</span>
        <Switch checked={cfg.enabled} onCheckedChange={v => set({ enabled: v })} />
      </div>

      {cfg.stations.map((s, idx) => (
        <div key={s.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className={inputCls}
              value={s.name}
              maxLength={20}
              placeholder="Station name (e.g. South Indian)"
              onChange={e => setStation(s.id, { name: e.target.value })}
            />
            <button type="button" aria-label="Move up" onClick={() => move(idx, -1)} className="p-2 rounded hover:bg-gray-100 text-gray-500"><ArrowUp className="w-4 h-4" /></button>
            <button type="button" aria-label="Move down" onClick={() => move(idx, 1)} className="p-2 rounded hover:bg-gray-100 text-gray-500"><ArrowDown className="w-4 h-4" /></button>
            <button type="button" aria-label="Delete station" onClick={() => set({ stations: cfg.stations.filter(x => x.id !== s.id) })} className="p-2 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {active.map(c => {
              const owner = ownerOf(c.id);
              const mine = s.categoryIds.indexOf(c.id) >= 0;
              // Locked only while ANOTHER station owns it and this one doesn't hold it: a category saved
              // in two stations must stay untickable here (it is checked, so it has to be removable).
              const taken = !!owner && owner.id !== s.id && !mine;
              return (
                <label key={c.id} className={`flex items-center gap-2 text-xs py-1 ${taken ? "text-gray-300" : "text-gray-700"}`}>
                  <input
                    type="checkbox"
                    checked={mine}
                    disabled={taken}
                    onChange={e => setStation(s.id, {
                      categoryIds: e.target.checked ? [...s.categoryIds, c.id] : s.categoryIds.filter(id => id !== c.id),
                    })}
                  />
                  <span className="truncate">{c.name}{taken ? ` (${owner!.name || "other"})` : ""}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => set({ stations: [...cfg.stations, { id: `st_${Date.now().toString(36)}`, name: "", categoryIds: [] }] })}
        className="flex items-center gap-1 text-sm text-emerald-600 font-medium"
      >
        <Plus className="w-4 h-4" /> Add station
      </button>

      <div>
        <label className="text-xs text-gray-500">General ticket name (categories in no station)</label>
        <input className={inputCls} maxLength={20} value={cfg.generalName} onChange={e => set({ generalName: e.target.value })} />
      </div>
    </Collapsible>
  );
}

/** Categories / single items that never print on a KOT nor show on the Kitchen screen (still billed). */
export function SkipKotSection({ value, onChange }: {
  value: SkipKotSettings | undefined;
  onChange: (next: SkipKotSettings) => void;
}) {
  const skip = value ?? DEFAULT_SKIP;
  const [q, setQ] = useState("");
  const { data: categories = [] } = useQuery<CategoryLite[]>({ queryKey: ["/api/categories"] });
  const { data: menu = [] } = useQuery<MenuItemLite[]>({ queryKey: ["/api/menu"] });
  const nameOf = (id: number) => menu.find(m => m.id === id)?.name ?? `Item #${id}`;
  const matches = q.trim()
    ? menu.filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase()) && skip.itemIds.indexOf(m.id) < 0).slice(0, 8)
    : [];
  const count = skip.categoryIds.length + skip.itemIds.length;

  return (
    <Collapsible title={`Don't print on KOT${count ? ` · ${count}` : ""}`}>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        These never go to the kitchen — no KOT (not even when Bill is pressed) and not on the Kitchen screen.
        They still appear on the bill. Example: Mineral Water.
      </p>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Whole categories</p>
        <div className="grid grid-cols-2 gap-1">
          {categories.filter(c => c.isActive !== false).map(c => (
            <label key={c.id} className="flex items-center gap-2 text-xs py-1 text-gray-700">
              <input
                type="checkbox"
                checked={skip.categoryIds.indexOf(c.id) >= 0}
                onChange={e => onChange({
                  ...skip,
                  categoryIds: e.target.checked ? [...skip.categoryIds, c.id] : skip.categoryIds.filter(id => id !== c.id),
                })}
              />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-gray-600 mb-1">Single items</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {skip.itemIds.map(id => (
            <span key={id} className="inline-flex items-center gap-1 text-xs bg-gray-100 rounded-full px-2 py-1">
              {nameOf(id)}
              <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange({ ...skip, itemIds: skip.itemIds.filter(x => x !== id) })}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <input className={inputCls} placeholder="Search an item (e.g. water)" value={q} onChange={e => setQ(e.target.value)} />
        {matches.length > 0 && (
          <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100">
            {matches.map(m => (
              <button
                key={m.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => { onChange({ ...skip, itemIds: [...skip.itemIds, m.id] }); setQ(""); }}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </Collapsible>
  );
}
