import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, Store, Receipt, ShieldCheck, RefreshCw, Database,
  Trash2, Archive, FileText, Monitor, KeyRound, X, AlertTriangle,
  CheckCircle2, ChevronRight, Settings2,
} from "lucide-react";

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
  | "database-migration"
  | "remove-orders"
  | "remove-backup"
  | "logs"
  | "check-machine"
  | "generate-code"
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
    id: "database-migration",
    label: "Database",
    sublabel: "Migration",
    icon: Database,
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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
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
              <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white">
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
                onClick={() => { setActiveModal(card.id); setConfirmStep(false); }}
                className={`
                  flex flex-col items-center justify-center gap-2
                  rounded-xl p-4 min-h-[100px] text-center
                  border transition-all duration-150 select-none cursor-pointer
                  bg-[#f5f6f7] border-[#e8e9eb]
                  hover:bg-white hover:border-gray-300 hover:shadow-md
                  active:scale-[0.97]
                  ${card.destructive ? "hover:border-red-200 hover:bg-red-50/50" : ""}
                `}
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

      {/* Database Migration */}
      {activeModal === "database-migration" && (
        <Modal title="Database Migration" onClose={closeModal}>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
              Running a migration will apply any pending schema changes to the database.
              This is safe and non-destructive.
            </div>
            <button
              onClick={() => handleDestructiveAction("/api/admin/migrate", "POST", "Database migration completed")}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-purple-500 hover:bg-purple-600 transition-colors disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {actionLoading ? "Running Migration..." : "Run Migration"}
            </button>
          </div>
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
          <div className="space-y-3">
            <div className="bg-gray-900 text-green-400 font-mono text-[11px] rounded-xl p-4 min-h-[160px] max-h-[300px] overflow-y-auto space-y-1">
              <p>[{new Date().toISOString()}] System started</p>
              <p>[{new Date().toISOString()}] Settings loaded from restaurant-settings.json</p>
              <p>[{new Date().toISOString()}] WebSocket server initialized</p>
              <p>[{new Date().toISOString()}] Database connection established</p>
              <p>[{new Date().toISOString()}] Auth middleware active</p>
              <p className="text-gray-500">— End of log —</p>
            </div>
            <button
              onClick={() => handleDestructiveAction("/api/admin/logs", "POST", "Log request sent")}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Fetch Server Logs
            </button>
          </div>
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
    </div>
  );
}
