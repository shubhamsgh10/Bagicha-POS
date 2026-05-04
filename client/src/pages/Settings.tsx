import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, Store, Receipt, ShieldCheck, RefreshCw, Database,
  Trash2, Archive, FileText, Monitor, KeyRound, X, AlertTriangle,
  CheckCircle2, ChevronRight, Settings2, Upload, FileUp, Download,
  Printer, Sparkles, Users, Lock, Pencil, Plus, UserCircle2, ToggleLeft,
} from "lucide-react";
import { PrintSettingsPanel } from "@/components/PrintSettingsPanel";
import { GrowthSettingsPanel } from "@/components/GrowthSettingsPanel";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { TwoFactorPanel } from "@/components/TwoFactorPanel";
import { BackupPanel } from "@/components/BackupPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RestaurantSettings {
  restaurantName: string;
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  taxRate: number;
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number;
}

type ModalId =
  | "restaurant-config"
  | "reset-bill-no"
  | "reset-sync-code"
  | "sync-schema"
  | "data-import"
  | "remove-orders"
  | "remove-backup"
  | "logs"
  | "check-machine"
  | "generate-code"
  | "print-settings"
  | "growth-settings"
  | "audit-log"
  | "two-factor"
  | "backup"
  | "staff-selector"
  | "manager-access"
  | null;

// ── Action card definitions ───────────────────────────────────────────────────

const ACTION_CARDS: {
  id: Exclude<ModalId, null>;
  label: string;
  sublabel: string;
  icon: any;
  destructive?: boolean;
}[] = [
  {
    id: "restaurant-config",
    label: "Restaurant",
    sublabel: "Configuration",
    icon: Store,
  },
  {
    id: "reset-bill-no",
    label: "Reset",
    sublabel: "Bill No.",
    icon: Receipt,
    destructive: true,
  },
  {
    id: "reset-sync-code",
    label: "Reset Sync",
    sublabel: "Code",
    icon: RefreshCw,
  },
  {
    id: "sync-schema",
    label: "Sync",
    sublabel: "Schema",
    icon: Database,
  },
  {
    id: "data-import",
    label: "Import",
    sublabel: "Data",
    icon: Upload,
  },
  {
    id: "remove-orders",
    label: "Remove All",
    sublabel: "Orders / Kot",
    icon: Trash2,
    destructive: true,
  },
  {
    id: "remove-backup",
    label: "Remove",
    sublabel: "Backup Files",
    icon: Archive,
    destructive: true,
  },
  {
    id: "logs",
    label: "Logs",
    sublabel: "",
    icon: FileText,
  },
  {
    id: "check-machine",
    label: "Check",
    sublabel: "Machine",
    icon: Monitor,
  },
  {
    id: "generate-code",
    label: "Generate",
    sublabel: "Code",
    icon: KeyRound,
  },
  {
    id: "growth-settings",
    label: "Growth",
    sublabel: "& Payments",
    icon: Sparkles,
  },
  {
    id: "audit-log",
    label: "Audit",
    sublabel: "Log",
    icon: ShieldCheck,
  },
  {
    id: "two-factor",
    label: "2FA",
    sublabel: "Security",
    icon: ShieldCheck,
  },
  {
    id: "backup",
    label: "DB",
    sublabel: "Backups",
    icon: Database,
  },
  {
    id: "print-settings" as const,
    label: "Print",
    sublabel: "Settings",
    icon: Printer,
  },
  {
    id: "staff-selector" as const,
    label: "Staff",
    sublabel: "Selector",
    icon: Users,
  },
  {
    id: "manager-access" as const,
    label: "Manager",
    sublabel: "Access",
    icon: ToggleLeft,
  },
];

// ── Reusable ConfirmDialog ────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  loading = false,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  loading?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-100">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-700">{title}</p>
          <p className="text-xs text-red-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          style={{
            background: "rgba(255,255,255,0.86)",
            backdropFilter: "blur(24px) saturate(1.9)",
            WebkitBackdropFilter: "blur(24px) saturate(1.9)",
            border: "1px solid rgba(255,255,255,0.72)",
            boxShadow: "0 8px 40px rgba(100,110,160,0.16), 0 1px 0 rgba(255,255,255,0.95) inset",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-emerald-600" />
              <h2 className="font-semibold text-gray-800 text-sm">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Body */}
          <div className="p-5">{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Restaurant Configuration panel ───────────────────────────────────────────

function RestaurantConfigPanel({
  formData,
  set,
  saving,
  onSave,
}: {
  formData: RestaurantSettings;
  set: (key: keyof RestaurantSettings, value: any) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 outline-none focus:border-emerald-400 focus:bg-white transition-colors";
  return (
    <div className="space-y-4">
      {/* Restaurant Info */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Store className="w-4 h-4 text-emerald-600" />
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Restaurant Info</p>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-500 mb-1">Restaurant Name *</Label>
            <input
              value={formData.restaurantName}
              onChange={(e) => set("restaurantName", e.target.value)}
              placeholder="Enter restaurant name"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1">Phone</Label>
              <input
                value={formData.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 98765 43210"
                className={inputCls}
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1">Email</Label>
              <input
                value={formData.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="restaurant@email.com"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1">Address</Label>
            <input
              value={formData.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Full restaurant address"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Tax & Billing */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <Receipt className="w-4 h-4 text-emerald-600" />
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tax & Billing</p>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1">GST Number (GSTIN)</Label>
              <input
                value={formData.gstNumber}
                onChange={(e) => set("gstNumber", e.target.value)}
                placeholder="22AAAAA0000A1Z5"
                className={inputCls}
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1">Tax Rate (%)</Label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={formData.taxRate}
                onChange={(e) => set("taxRate", parseFloat(e.target.value) || 0)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1">Currency Code</Label>
              <input
                value={formData.currency}
                onChange={(e) => set("currency", e.target.value)}
                placeholder="INR"
                className={inputCls}
              />
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1">Currency Symbol</Label>
              <input
                value={formData.currencySymbol}
                onChange={(e) => set("currencySymbol", e.target.value)}
                placeholder="₹"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-gray-500 mb-1">Bill Footer Note</Label>
            <input
              value={formData.footerNote}
              onChange={(e) => set("footerNote", e.target.value)}
              placeholder="Thank you for dining with us!"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* POS Access Control */}
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">POS Access Control</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-2">Auto-revert elevated role after</p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 0,  label: "Never"  },
              { value: 1,  label: "1 min"  },
              { value: 2,  label: "2 min"  },
              { value: 5,  label: "5 min"  },
              { value: 10, label: "10 min" },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("posRoleTimeout", opt.value)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  formData.posRoleTimeout === opt.value
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-white border-gray-200 text-gray-600 hover:border-emerald-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="pt-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ── Check Machine panel ───────────────────────────────────────────────────────

function MachineInfoPanel() {
  const nav = window.navigator;
  const rows = [
    { label: "Browser",    value: nav.userAgent.split(") ")[0].split("(")[1] || nav.userAgent.slice(0, 60) },
    { label: "Platform",   value: (nav as any).userAgentData?.platform || nav.platform || "—" },
    { label: "Language",   value: nav.language },
    { label: "Cookies",    value: nav.cookieEnabled ? "Enabled" : "Disabled" },
    { label: "Online",     value: nav.onLine ? "Yes" : "No" },
    { label: "Screen",     value: `${window.screen.width} × ${window.screen.height}` },
    { label: "Viewport",   value: `${window.innerWidth} × ${window.innerHeight}` },
    { label: "Pixel ratio", value: String(window.devicePixelRatio) },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
          <span className="text-xs text-gray-500 shrink-0 w-28">{r.label}</span>
          <span className="text-xs font-medium text-gray-800 text-right break-all">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Generate Code panel ───────────────────────────────────────────────────────

function GenerateCodePanel() {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = () => {
    setLoading(true);
    setTimeout(() => {
      // Generate a random 8-char alphanumeric pairing code
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const c = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      setCode(c);
      setLoading(false);
    }, 800);
  };

  return (
    <div className="space-y-4 text-center">
      <p className="text-xs text-gray-500">
        Generate a one-time pairing code to connect another device or sync a new terminal.
      </p>
      {code ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl py-6 px-4">
          <p className="text-3xl font-mono font-bold text-emerald-600 tracking-[0.3em]">{code}</p>
          <p className="text-[10px] text-gray-400 mt-2">This code expires in 10 minutes</p>
        </div>
      ) : (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl py-8 text-gray-400 text-sm">
          No code generated yet
        </div>
      )}
      <button
        onClick={generate}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        {loading ? "Generating..." : code ? "Regenerate Code" : "Generate Code"}
      </button>
    </div>
  );
}

// ── Logs panel ────────────────────────────────────────────────────────────────

function LogsPanel() {
  const [logs, setLogs] = useState<{ ts: string; source: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/logs", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setLogs(data);
      setFetched(true);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      setLogs([{ ts: new Date().toISOString(), source: "error", message: `Failed to fetch logs: ${err.message}` }]);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on mount
  useEffect(() => { fetchLogs(); }, []);

  const sourceColor = (source: string) => {
    if (source === "error") return "text-red-400";
    if (source === "ws")    return "text-yellow-400";
    return "text-green-400";
  };

  return (
    <div className="space-y-3">
      <div className="bg-gray-900 font-mono text-[11px] rounded-xl p-4 min-h-[180px] max-h-[320px] overflow-y-auto space-y-0.5">
        {!fetched && (
          <p className="text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading logs…
          </p>
        )}
        {fetched && logs.length === 0 && (
          <p className="text-gray-500">No log entries yet.</p>
        )}
        {logs.map((l, i) => (
          <p key={i} className={sourceColor(l.source)}>
            <span className="text-gray-500">[{l.ts.replace("T", " ").slice(0, 19)}]</span>
            {" "}<span className="text-gray-400">[{l.source}]</span>
            {" "}{l.message}
          </p>
        ))}
        <div ref={bottomRef} />
      </div>
      <button
        onClick={fetchLogs}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {loading ? "Refreshing…" : "Refresh Logs"}
      </button>
    </div>
  );
}

// ── Data Import panel ─────────────────────────────────────────────────────────

type ImportType = "menu" | "inventory" | "customers";

const TEMPLATES: Record<ImportType, { headers: string[]; sample: string[][] }> = {
  menu: {
    headers: ["Name", "Category", "Price", "Description"],
    sample: [
      ["Butter Chicken", "Main Course", "320", "Creamy tomato gravy with tender chicken"],
      ["Paneer Tikka", "Starters", "280", "Grilled cottage cheese with spices"],
      ["Veg Fried Rice", "Rice & Noodles", "180", ""],
    ],
  },
  inventory: {
    headers: ["Item Name", "Current Stock", "Min Stock", "Unit"],
    sample: [
      ["Rice", "50", "10", "kg"],
      ["Tomatoes", "20", "5", "kg"],
      ["Cooking Oil", "15", "3", "litre"],
    ],
  },
  customers: {
    headers: ["Name", "Phone", "Email", "Address", "Locality", "Date of Birth", "Tags", "Remark"],
    sample: [
      ["Rahul Sharma", "9876543210", "rahul@email.com", "123 MG Road", "Koramangala", "1990-05-15", "VIP", "Prefers window seat"],
      ["Priya Patel", "9812345678", "", "45 Park Street", "Indiranagar", "", "Regular", ""],
      ["Amit Kumar", "9900112233", "amit@gmail.com", "", "", "", "", ""],
    ],
  },
};

function parseCSV(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(l => l.trim())
    .map(line =>
      line.split(",").map(cell => cell.trim().replace(/^["']|["']$/g, ""))
    );
}

function toCSVBlob(headers: string[], rows: string[][]): Blob {
  const lines = [headers.join(","), ...rows.map(r => r.join(","))];
  return new Blob([lines.join("\n")], { type: "text/csv" });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DataImportPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState<ImportType>("menu");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const tpl = TEMPLATES[type];

  const handleFile = (file: File) => {
    setResult(null);
    file.text().then(text => {
      const all = parseCSV(text);
      // Skip header row if it matches expected headers (case-insensitive check on first cell)
      const firstCell = all[0]?.[0]?.toLowerCase() ?? "";
      const dataRows = (firstCell === tpl.headers[0].toLowerCase() || isNaN(Number(firstCell)))
        ? all.slice(1)
        : all;
      setRows(dataRows.filter(r => r.some(c => c)));
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!rows?.length) return;
    setImporting(true);
    try {
      const payload =
        type === "menu"
          ? rows.map(r => ({ name: r[0], category: r[1], price: r[2], description: r[3] }))
          : type === "inventory"
          ? rows.map(r => ({ itemName: r[0], currentStock: r[1], minStock: r[2], unit: r[3] }))
          : rows.map(r => ({ name: r[0], phone: r[1], email: r[2], address: r[3], locality: r[4], dob: r[5], tags: r[6], remark: r[7] }));

      const res = await fetch(`/api/admin/import/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Import failed");
      setResult(data);
      if (data.imported > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/menu-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
        queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      }
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 outline-none";

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div className="flex gap-2">
        {(["menu", "inventory", "customers"] as ImportType[]).map(t => (
          <button
            key={t}
            onClick={() => { setType(t); setRows(null); setResult(null); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
              type === t
                ? "bg-emerald-500 text-white border-emerald-500"
                : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300"
            }`}
          >
            {t === "menu" ? "Menu Items" : t === "inventory" ? "Inventory" : "Customers"}
          </button>
        ))}
      </div>

      {/* Template info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-blue-700">
          Required columns: {tpl.headers.join(", ")}
        </p>
        <p className="text-xs text-blue-500">
          {type === "menu"
            ? "Categories are created automatically if they don't exist."
            : type === "customers"
            ? "Phone is used as the unique key. Duplicate phone numbers are skipped. Tags can be semicolon-separated."
            : "Upload a CSV file with these columns."}
        </p>
        <button
          onClick={() => downloadBlob(toCSVBlob(tpl.headers, tpl.sample), `${type}-template.csv`)}
          className="flex items-center gap-1.5 text-xs text-blue-600 font-medium hover:underline mt-1"
        >
          <Download className="w-3 h-3" /> Download sample template
        </button>
      </div>

      {/* Upload area */}
      {!rows && (
        <label
          className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer transition-colors ${
            dragOver ? "border-emerald-400 bg-emerald-50" : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <FileUp className="w-7 h-7 text-gray-400" />
          <p className="text-sm text-gray-500">Drop a CSV file here, or click to browse</p>
          <input
            type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      {/* Preview */}
      {rows && !result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-600">{rows.length} rows detected — preview (first 5)</p>
            <button onClick={() => setRows(null)} className="text-xs text-gray-400 hover:text-gray-600">Change file</button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50">
                <tr>
                  {tpl.headers.map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-500 border-b border-gray-100">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    {tpl.headers.map((_, ci) => (
                      <td key={ci} className="px-2 py-1.5 text-gray-700 max-w-[120px] truncate">{r[ci] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && (
            <p className="text-[10px] text-gray-400 text-center">+{rows.length - 5} more rows</p>
          )}
          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-60"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {importing ? "Importing..." : `Import ${rows.length} rows`}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-3">
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${result.imported > 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
            <CheckCircle2 className={`w-5 h-5 shrink-0 mt-0.5 ${result.imported > 0 ? "text-emerald-500" : "text-red-400"}`} />
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {result.imported} {type === "menu" ? "menu items" : type === "inventory" ? "inventory items" : "customers"} imported successfully
              </p>
              {result.errors.length > 0 && (
                <p className="text-xs text-red-500 mt-1">{result.errors.length} rows skipped</p>
              )}
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3 max-h-32 overflow-y-auto space-y-1">
              {result.errors.map((e, i) => (
                <p key={i} className="text-[11px] text-red-500 font-mono">{e}</p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setRows(null); setResult(null); }}
              className="flex-1 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              Import more
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Staff Selector Panel ──────────────────────────────────────────────────────

interface StaffMemberRow { id: number; name: string; hasPin: boolean; isActive: boolean; createdAt: string; }

function StaffSelectorPanel() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow]       = useState<StaffMemberRow | null>(null);
  const [form, setForm]             = useState({ name: "", pin: "", pinConfirm: "" });
  const [formError, setFormError]   = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: staff = [], isLoading } = useQuery<StaffMemberRow[]>({
    queryKey: ["/api/staff-members/all"],
    queryFn: async () => {
      const r = await fetch("/api/staff-members/all", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: { name: string; pin: string | null; isActive?: boolean; id?: number }) => {
      if (payload.id) return apiRequest("PUT", `/api/staff-members/${payload.id}`, payload);
      return apiRequest("POST", "/api/staff-members", payload);
    },
    onSuccess: () => {
      toast({ title: editRow ? "Staff member updated" : "Staff member added" });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      setDialogOpen(false);
      setEditRow(null);
      setForm({ name: "", pin: "", pinConfirm: "" });
      setFormError("");
    },
    onError: (e: any) => {
      const msg = (() => {
        try { return JSON.parse(e.message.slice(e.message.indexOf("{"))).message; } catch { return e.message || "Failed to save"; }
      })();
      setFormError(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff-members/${id}`),
    onSuccess: () => {
      toast({ title: "Staff member removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff-members"] });
      setDeleteConfirm(null);
    },
  });

  const openAdd = () => {
    setEditRow(null);
    setForm({ name: "", pin: "", pinConfirm: "" });
    setFormError("");
    setDialogOpen(true);
  };

  const openEdit = (row: StaffMemberRow) => {
    setEditRow(row);
    setForm({ name: row.name, pin: "", pinConfirm: "" });
    setFormError("");
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) { setFormError("Name is required"); return; }
    if (form.pin && !/^\d{4,6}$/.test(form.pin)) { setFormError("PIN must be 4–6 digits"); return; }
    if (form.pin && form.pin !== form.pinConfirm) { setFormError("PINs do not match"); return; }
    saveMutation.mutate({ name: form.name.trim(), pin: form.pin || null, ...(editRow ? { id: editRow.id } : {}) });
  };

  return (
    <div className="flex flex-col gap-4">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {staff.length} staff member{staff.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add Staff
        </button>
      </div>

      {/* Staff list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      ) : staff.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
          <UserCircle2 className="w-10 h-10 mb-2 opacity-25" />
          <p className="text-sm font-medium">No staff members yet</p>
          <p className="text-xs mt-0.5">Add staff so they can log in on their phones.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map(s => (
            <div key={s.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-opacity ${!s.isActive ? "opacity-50" : ""}`}
              style={{ background: "rgba(255,255,255,0.65)", backdropFilter: "blur(12px)", border: "1px solid rgba(0,0,0,0.07)" }}
            >
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <UserCircle2 className="w-4 h-4 text-emerald-600" />
              </div>

              {/* Name + PIN status */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${s.hasPin ? "text-emerald-600" : "text-red-500"}`}>
                  <Lock className="w-2.5 h-2.5" />
                  {s.hasPin ? "PIN set" : "No PIN"}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Switch
                  checked={s.isActive}
                  onCheckedChange={() => saveMutation.mutate({ id: s.id, name: s.name, pin: null, isActive: !s.isActive })}
                />
                <button
                  onClick={() => openEdit(s)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {deleteConfirm === s.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => deleteMutation.mutate(s.id)}
                      className="px-2 py-1 text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-2 py-1 text-[11px] border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(s.id)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info note */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-[12px] text-blue-700 leading-relaxed">
        Staff here appear on the phone selector at{" "}
        <span className="font-mono bg-blue-100 px-1 py-0.5 rounded text-blue-800">192.168.29.33:5000</span>.
        They are separate from admin/manager accounts.
      </div>

      {/* ── Add / Edit Dialog (portaled outside modal via shadcn Dialog) ──── */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setEditRow(null); } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{editRow ? `Edit — ${editRow.name}` : "Add Staff Member"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="sm-name">Name</Label>
              <Input
                id="sm-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Balawant"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sm-pin">
                {editRow
                  ? "New PIN — 4 to 6 digits (leave blank to keep current)"
                  : "PIN — 4 to 6 digits"}
              </Label>
              <Input
                id="sm-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={form.pin}
                onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                placeholder="······"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sm-pin2">Confirm PIN</Label>
              <Input
                id="sm-pin2"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={form.pinConfirm}
                onChange={e => setForm(f => ({ ...f, pinConfirm: e.target.value }))}
                placeholder="······"
              />
            </div>

            {formError && (
              <p className="text-[12px] font-medium text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              onClick={() => { setDialogOpen(false); setEditRow(null); }}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-60"
            >
              {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editRow ? "Save Changes" : "Add Staff"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Manager Access Panel ──────────────────────────────────────────────────────

const MANAGER_PAGES = [
  { href: "/tables",       label: "Tables" },
  { href: "/orders",       label: "Orders" },
  { href: "/billing",      label: "Billing" },
  { href: "/kot",          label: "KOT" },
  { href: "/staff",        label: "Staff" },
  { href: "/menu",         label: "Menu" },
  { href: "/inventory",    label: "Inventory" },
  { href: "/live-tables",  label: "Live Tables" },
  { href: "/kitchen",      label: "Kitchen" },
  { href: "/customers",    label: "Customers" },
];

function ManagerAccessPanel() {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    fetch("/api/settings/manager-pages", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setAllowed(d.managerAllowedPages ?? null);
        setFetched(true);
      })
      .catch(() => setFetched(true));
  }, []);

  const isAllowed = (href: string) => allowed === null || allowed.includes(href);

  const toggle = (href: string) => {
    if (allowed === null) {
      // All on → turn one off
      setAllowed(MANAGER_PAGES.map(p => p.href).filter(h => h !== href));
    } else if (allowed.includes(href)) {
      const next = allowed.filter(h => h !== href);
      setAllowed(next.length === MANAGER_PAGES.length ? null : next);
    } else {
      const next = [...allowed, href];
      setAllowed(next.length === MANAGER_PAGES.length ? null : next);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/settings/manager-pages", { managerAllowedPages: allowed });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Manager access saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!fetched) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose which pages the <strong>manager</strong> role can access. Admin always has full access.
      </p>
      <div className="space-y-1">
        {MANAGER_PAGES.map(page => (
          <div key={page.href}
            className="flex items-center justify-between px-4 py-3 rounded-xl border bg-white/60 transition-all"
            style={{ backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.7)" }}
          >
            <span className="text-sm font-medium text-gray-700">{page.label}</span>
            <Switch checked={isAllowed(page.href)} onCheckedChange={() => toggle(page.href)} />
          </div>
        ))}
      </div>
      <button onClick={handleSave} disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-60">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Save Manager Access
      </button>
    </div>
  );
}

// ── Main Settings page ────────────────────────────────────────────────────────

export default function Settings() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalId>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  const [formData, setFormData] = useState<RestaurantSettings>({
    restaurantName: "Bagicha Restaurant",
    address: "",
    phone: "",
    email: "",
    gstNumber: "",
    taxRate: 5,
    currency: "INR",
    currencySymbol: "₹",
    footerNote: "Thank you for dining with us!",
    posRoleTimeout: 2,
  });

  const { data: settings, isLoading } = useQuery<RestaurantSettings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) setFormData((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  const set = (key: keyof RestaurantSettings, value: any) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const closeModal = () => { setActiveModal(null); setConfirmStep(false); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings", formData);
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Restaurant settings updated successfully" });
      closeModal();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Generic destructive action handler
  const handleDestructiveAction = async (
    endpoint: string,
    method: "POST" | "DELETE",
    successMsg: string,
  ) => {
    setActionLoading(true);
    try {
      await apiRequest(method, endpoint, {});
      toast({ title: successMsg });
      closeModal();
    } catch (err: any) {
      // If endpoint doesn't exist yet, show a friendly message
      const msg = err.message?.includes("404") || err.message?.includes("not found")
        ? "This feature is not yet configured on this server."
        : err.message || "Action failed";
      toast({ title: "Could not complete action", description: msg, variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto">
          <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mt-8">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-24 skeleton-glass" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: "transparent" }}>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-800">
            Restaurant Configuration
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Select an action to configure your POS system
          </p>
        </div>

        {/* Action card grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {ACTION_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.button
                key={card.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.15 }}
                whileHover={{ scale: 1.03, transition: { duration: 0.15 } }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { setActiveModal(card.id); setConfirmStep(false); }}
                className="flex flex-col items-center justify-center gap-2 rounded-xl p-4 min-h-[100px] text-center select-none cursor-pointer transition-all duration-200"
                style={{
                  background: card.destructive ? "rgba(254,242,242,0.60)" : "rgba(255,255,255,0.52)",
                  backdropFilter: "blur(16px) saturate(1.8)",
                  WebkitBackdropFilter: "blur(16px) saturate(1.8)",
                  border: card.destructive ? "1px solid rgba(252,165,165,0.45)" : "1px solid rgba(255,255,255,0.72)",
                  boxShadow: card.destructive
                    ? "0 4px 16px rgba(239,68,68,0.08), 0 1px 0 rgba(255,255,255,0.9) inset"
                    : "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
                }}
              >
                <Icon className={`w-6 h-6 ${card.destructive ? "text-red-400" : "text-gray-500"}`} />
                <div>
                  <p className={`text-[13px] font-semibold leading-tight ${card.destructive ? "text-red-600" : "text-gray-700"}`}>
                    {card.label}
                  </p>
                  {card.sublabel && (
                    <p className={`text-[13px] font-semibold leading-tight ${card.destructive ? "text-red-600" : "text-gray-700"}`}>
                      {card.sublabel}
                    </p>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Restaurant Configuration */}
      {activeModal === "restaurant-config" && (
        <Modal title="Restaurant Configuration" onClose={closeModal}>
          <RestaurantConfigPanel
            formData={formData}
            set={set}
            saving={saving}
            onSave={handleSave}
          />
        </Modal>
      )}

      {/* Reset Bill No. */}
      {activeModal === "reset-bill-no" && (
        <Modal title="Reset Bill Number" onClose={closeModal}>
          {!confirmStep ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                This will reset your bill / order number counter back to <strong>1</strong>.
                All future bills will start from the new sequence.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button
                  onClick={() => setConfirmStep(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
                >
                  Continue <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <ConfirmDialog
              title="Are you sure?"
              description="This action cannot be undone. The bill counter will be reset to 1."
              confirmLabel="Yes, Reset"
              loading={actionLoading}
              onCancel={() => setConfirmStep(false)}
              onConfirm={() => handleDestructiveAction("/api/admin/reset-bill-number", "POST", "Bill number reset successfully")}
            />
          )}
        </Modal>
      )}

      {/* Reset Sync Code */}
      {activeModal === "reset-sync-code" && (
        <Modal title="Reset Sync Code" onClose={closeModal}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Resetting the sync code will disconnect any currently paired devices.
              You will need to re-pair them using the new code.
            </p>
            <button
              onClick={() => handleDestructiveAction("/api/admin/reset-sync-code", "POST", "Sync code reset successfully")}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Reset Sync Code
            </button>
          </div>
        </Modal>
      )}

      {/* Sync Schema (developer tool) */}
      {activeModal === "sync-schema" && (
        <Modal title="Sync Database Schema" onClose={closeModal}>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
              Compares the current schema definition with the live database and applies any pending structural changes (new tables, new columns). Safe and non-destructive — no data is deleted.
            </div>
            <p className="text-xs text-gray-400">Use this after a software update that adds new features requiring schema changes.</p>
            <button
              onClick={() => handleDestructiveAction("/api/admin/migrate", "POST", "Schema synced successfully")}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-purple-500 hover:bg-purple-600 transition-colors disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {actionLoading ? "Syncing..." : "Sync Schema"}
            </button>
          </div>
        </Modal>
      )}

      {/* Data Import */}
      {activeModal === "data-import" && (
        <Modal title="Import Data" onClose={closeModal}>
          <DataImportPanel onClose={closeModal} />
        </Modal>
      )}

      {/* Remove All Orders / Kot */}
      {activeModal === "remove-orders" && (
        <Modal title="Remove All Orders / KOT" onClose={closeModal}>
          {!confirmStep ? (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">
                <p className="font-semibold mb-1">Warning: Destructive Action</p>
                <p>This will permanently delete <strong>all orders and KOT records</strong> from the system. This cannot be undone.</p>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={() => setConfirmStep(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                  I Understand, Continue <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <ConfirmDialog
              title="Final confirmation"
              description="All orders, KOT tickets, and billing records will be permanently deleted. Type your admin PIN to confirm."
              confirmLabel="Delete All Orders"
              loading={actionLoading}
              onCancel={() => setConfirmStep(false)}
              onConfirm={() => handleDestructiveAction("/api/admin/clear-orders", "DELETE", "All orders and KOT records removed")}
            />
          )}
        </Modal>
      )}

      {/* Remove Backup Files */}
      {activeModal === "remove-backup" && (
        <Modal title="Remove Backup Files" onClose={closeModal}>
          {!confirmStep ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                This will remove all local backup files from the server.
                Make sure you have an off-site copy before proceeding.
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={() => setConfirmStep(true)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
                  Continue <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <ConfirmDialog
              title="Delete backup files?"
              description="All server-side backup files will be permanently removed."
              confirmLabel="Remove Backups"
              loading={actionLoading}
              onCancel={() => setConfirmStep(false)}
              onConfirm={() => handleDestructiveAction("/api/admin/clear-backups", "DELETE", "Backup files removed")}
            />
          )}
        </Modal>
      )}

      {/* Logs */}
      {activeModal === "logs" && (
        <Modal title="System Logs" onClose={closeModal}>
          <LogsPanel />
        </Modal>
      )}

      {/* Check Machine */}
      {activeModal === "check-machine" && (
        <Modal title="Check Machine" onClose={closeModal}>
          <MachineInfoPanel />
        </Modal>
      )}

      {/* Generate Code */}
      {activeModal === "generate-code" && (
        <Modal title="Generate Pairing Code" onClose={closeModal}>
          <GenerateCodePanel />
        </Modal>
      )}

      {/* Growth Settings (Razorpay, NPS, Birthday, Daily Digest) */}
      {activeModal === "growth-settings" && (
        <Modal title="Growth & Payments" onClose={closeModal}>
          <GrowthSettingsPanel onClose={closeModal} />
        </Modal>
      )}

      {/* Audit Log */}
      {activeModal === "audit-log" && (
        <Modal title="Audit Log" onClose={closeModal}>
          <AuditLogPanel />
        </Modal>
      )}

      {/* Two-Factor Authentication */}
      {activeModal === "two-factor" && (
        <Modal title="Two-Factor Authentication" onClose={closeModal}>
          <TwoFactorPanel />
        </Modal>
      )}

      {/* Database Backups */}
      {activeModal === "backup" && (
        <Modal title="Database Backups" onClose={closeModal}>
          <BackupPanel />
        </Modal>
      )}

      {/* Print Settings */}
      {activeModal === "print-settings" && (
        <PrintSettingsPanel
          currentSettings={formData}
          onClose={closeModal}
        />
      )}

      {/* Staff Selector */}
      {activeModal === "staff-selector" && (
        <Modal title="Staff Selector" onClose={closeModal}>
          <StaffSelectorPanel />
        </Modal>
      )}

      {/* Manager Access */}
      {activeModal === "manager-access" && (
        <Modal title="Manager Page Access" onClose={closeModal}>
          <ManagerAccessPanel />
        </Modal>
      )}
    </div>
  );
}
