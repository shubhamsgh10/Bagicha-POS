import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Wifi, Usb, TestTube2, CheckCircle2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types (mirror server/settingsStore.ts) ─────────────────────────────────────

interface PrinterConfig {
  id: string;
  name: string;
  type: 'network' | 'usb';
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
  width?: number;
}

interface KOTPrintSettings {
  enabled: boolean;
  printOnBill: boolean;
  printModifiedKOT: boolean;
  printModifiedItemsOnly: boolean;
  printCancelledKOT: boolean;
  printAddons: boolean;
  showDuplicateWatermark: boolean;
  printDeletedItems: boolean;
  printDeletedSeparate: boolean;
  printOnTableMove: boolean;
  kotPrinterId: string | null;
}

interface BillPrintSettings {
  taxDisplay: 'none' | 'category-wise';
  itemPriceMode: 'exclusive' | 'inclusive';
  showBackwardTax: boolean;
  showDuplicate: boolean;
  showCustomerPayment: boolean;
  showKotAsToken: boolean;
  showAddons: boolean;
  mergeDuplicateItems: boolean;
  showOrderBarcode: boolean;
  showQuantityBreakdown: boolean;
  billPrinterId: string | null;
}

interface PrintConfigSettings {
  printers: PrinterConfig[];
  kot: KOTPrintSettings;
  bill: BillPrintSettings;
}

const DEFAULT_KOT: KOTPrintSettings = {
  enabled: true, printOnBill: true, printModifiedKOT: true,
  printModifiedItemsOnly: true, printCancelledKOT: true, printAddons: true,
  showDuplicateWatermark: true, printDeletedItems: true, printDeletedSeparate: false,
  printOnTableMove: false, kotPrinterId: null,
};

const DEFAULT_BILL: BillPrintSettings = {
  taxDisplay: 'none', itemPriceMode: 'exclusive', showBackwardTax: true,
  showDuplicate: true, showCustomerPayment: false, showKotAsToken: false,
  showAddons: true, mergeDuplicateItems: true, showOrderBarcode: false,
  showQuantityBreakdown: false, billPrinterId: null,
};

// ── Toggle row ────────────────────────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && (
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0 mt-0.5" />
    </div>
  );
}

// ── Printer Setup Tab ─────────────────────────────────────────────────────────

function PrinterSetupTab({ printers, onChange, onTest }: {
  printers: PrinterConfig[];
  onChange: (printers: PrinterConfig[]) => void;
  onTest: (printerId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<PrinterConfig>>({ type: 'network', port: 9100, width: 32 });

  const inputCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 w-full bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

  const addPrinter = () => {
    if (!form.name?.trim()) return;
    const newPrinter: PrinterConfig = {
      id: Date.now().toString(),
      name: form.name.trim(),
      type: form.type as 'network' | 'usb',
      ip: form.ip,
      port: form.port ?? 9100,
      vendorId: form.vendorId,
      productId: form.productId,
      width: form.width ?? 32,
    };
    onChange([...printers, newPrinter]);
    setAdding(false);
    setForm({ type: 'network', port: 9100, width: 32 });
  };

  const remove = (id: string) => onChange(printers.filter(p => p.id !== id));

  return (
    <div className="space-y-4">
      {printers.length === 0 && !adding && (
        <div className="text-center py-10 rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-sm text-gray-400">No printers configured</p>
          <p className="text-xs text-gray-300 mt-1">Add a network (TCP/IP) or USB thermal printer</p>
        </div>
      )}

      {printers.map(p => (
        <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0">
            {p.type === 'network'
              ? <Wifi className="w-4 h-4 text-blue-500" />
              : <Usb className="w-4 h-4 text-purple-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">{p.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {p.type === 'network'
                ? `${p.ip ?? '—'}:${p.port ?? 9100}`
                : `VID:0x${(p.vendorId ?? 0).toString(16).padStart(4,'0')} PID:0x${(p.productId ?? 0).toString(16).padStart(4,'0')}`}
              {' · '}{p.width ?? 32} chars
            </p>
          </div>
          <button
            onClick={() => onTest(p.id)}
            title="Send test page"
            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-400 transition-colors"
          >
            <TestTube2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => remove(p.id)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-700">Add Printer</p>

          <div className="grid grid-cols-2 gap-2">
            {(['network', 'usb'] as const).map(t => (
              <button
                key={t}
                onClick={() => setForm(f => ({ ...f, type: t }))}
                className={`py-2 rounded-lg text-xs font-medium border transition-all ${
                  form.type === t
                    ? t === 'network' ? 'bg-blue-500 text-white border-blue-500' : 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {t === 'network' ? <><Wifi className="w-3.5 h-3.5 inline mr-1" />Network</> : <><Usb className="w-3.5 h-3.5 inline mr-1" />USB</>}
              </button>
            ))}
          </div>

          <input
            className={inputCls}
            placeholder="Printer name (e.g. Kitchen Printer)"
            value={form.name ?? ''}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />

          {form.type === 'network' ? (
            <div className="grid grid-cols-3 gap-2">
              <input
                className={`${inputCls} col-span-2`}
                placeholder="IP address (e.g. 192.168.1.100)"
                value={form.ip ?? ''}
                onChange={e => setForm(f => ({ ...f, ip: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Port"
                type="number"
                value={form.port ?? 9100}
                onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || 9100 }))}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  placeholder="Vendor ID hex (e.g. 04b8)"
                  value={form.vendorId != null ? '0x' + form.vendorId.toString(16).padStart(4,'0') : ''}
                  onChange={e => {
                    const v = parseInt(e.target.value.replace(/^0x/i,''), 16);
                    setForm(f => ({ ...f, vendorId: isNaN(v) ? undefined : v }));
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="Product ID hex (e.g. 0202)"
                  value={form.productId != null ? '0x' + form.productId.toString(16).padStart(4,'0') : ''}
                  onChange={e => {
                    const v = parseInt(e.target.value.replace(/^0x/i,''), 16);
                    setForm(f => ({ ...f, productId: isNaN(v) ? undefined : v }));
                  }}
                />
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                USB requires Zadig WinUSB driver setup on Windows. Find VID/PID in Device Manager.
              </p>
            </>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Paper width:</label>
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none"
              value={form.width ?? 32}
              onChange={e => setForm(f => ({ ...f, width: parseInt(e.target.value) }))}
            >
              <option value={32}>32 chars (58mm paper)</option>
              <option value={48}>48 chars (80mm paper)</option>
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setAdding(false); setForm({ type: 'network', port: 9100, width: 32 }); }}
              className="flex-1 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={addPrinter}
              className="flex-1 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
            >
              Add Printer
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-emerald-600 border-2 border-dashed border-emerald-200 hover:bg-emerald-50 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Printer
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PrintSettingsPanel({
  currentSettings,
  onClose,
}: {
  currentSettings: any;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'kot' | 'bill' | 'printers'>('kot');

  const [ps, setPs] = useState<PrintConfigSettings>({
    printers: currentSettings?.printSettings?.printers ?? [],
    kot: { ...DEFAULT_KOT, ...(currentSettings?.printSettings?.kot ?? {}) },
    bill: { ...DEFAULT_BILL, ...(currentSettings?.printSettings?.bill ?? {}) },
  });

  const setKot = (key: keyof KOTPrintSettings, val: any) =>
    setPs(p => ({ ...p, kot: { ...p.kot, [key]: val } }));

  const setBill = (key: keyof BillPrintSettings, val: any) =>
    setPs(p => ({ ...p, bill: { ...p.bill, [key]: val } }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('PUT', '/api/settings', { ...currentSettings, printSettings: ps });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: 'Print settings saved' });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleTest = async (printerId: string) => {
    try {
      const res = await fetch('/api/print/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      toast({ title: 'Test page sent!', description: data.message });
    } catch (err: any) {
      toast({ title: 'Test failed', description: err.message, variant: 'destructive' });
    }
  };

  const printerOptions = [
    { value: '', label: '— None —' },
    ...ps.printers.map(p => ({ value: p.id, label: p.name })),
  ];

  const selectCls = "text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:border-emerald-400 focus:bg-white transition-colors";

  const tabs = [
    { id: 'kot' as const,      label: 'KOT Print' },
    { id: 'bill' as const,     label: 'Bill Print' },
    { id: 'printers' as const, label: 'Printer Setup' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">Print Settings</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure thermal printer behavior</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === t.id
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* KOT Print */}
          {activeTab === 'kot' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-gray-500 shrink-0 w-24">KOT Printer:</label>
                <select
                  className={selectCls}
                  value={ps.kot.kotPrinterId ?? ''}
                  onChange={e => setKot('kotPrinterId', e.target.value || null)}
                >
                  {printerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <ToggleRow label="Enable KOT Printing" checked={ps.kot.enabled} onChange={v => setKot('enabled', v)} />
              <ToggleRow
                label="Print KOT on Print Bill"
                description="This setting will only work when the print bill action is initiated for the first time. For reprint of KOT, use the KOT listing page."
                checked={ps.kot.printOnBill} onChange={v => setKot('printOnBill', v)}
              />
              <ToggleRow
                label="Print Only Modified KOT"
                description="When enabled, prints only the KOT where modification (i.e. item change or item deletion) occurred, with the label 'Modified' at the top of the KOT."
                checked={ps.kot.printModifiedKOT} onChange={v => setKot('printModifiedKOT', v)}
              />
              <ToggleRow label="Print Only Modified Items in KOT" checked={ps.kot.printModifiedItemsOnly} onChange={v => setKot('printModifiedItemsOnly', v)} />
              <ToggleRow label="Print Cancelled KOT" checked={ps.kot.printCancelledKOT} onChange={v => setKot('printCancelledKOT', v)} />
              <ToggleRow
                label="Print add-ons and special notes below item row in KOT"
                description="Print add-ons and special notes for the particular item below the item name row in KOT."
                checked={ps.kot.printAddons} onChange={v => setKot('printAddons', v)}
              />
              <ToggleRow
                label="Show Duplicate in KOT in case of multiple prints"
                description="When a KOT is re-printed, it would show Duplicate at the top of the KOT."
                checked={ps.kot.showDuplicateWatermark} onChange={v => setKot('showDuplicateWatermark', v)}
              />
              <ToggleRow label="Print Deleted Items In KOT" checked={ps.kot.printDeletedItems} onChange={v => setKot('printDeletedItems', v)} />
              <ToggleRow label="Print Deleted Items in separate KOT" checked={ps.kot.printDeletedSeparate} onChange={v => setKot('printDeletedSeparate', v)} />
              <ToggleRow
                label="While moving KOT items from one table to another, print KOT"
                checked={ps.kot.printOnTableMove} onChange={v => setKot('printOnTableMove', v)}
              />
            </div>
          )}

          {/* Bill Print */}
          {activeTab === 'bill' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <label className="text-xs text-gray-500 shrink-0 w-24">Bill Printer:</label>
                <select
                  className={selectCls}
                  value={ps.bill.billPrinterId ?? ''}
                  onChange={e => setBill('billPrinterId', e.target.value || null)}
                >
                  {printerOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div className="py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-2">Tax Display on Bill</p>
                <div className="flex gap-6">
                  {(['none', 'category-wise'] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="taxDisplay" checked={ps.bill.taxDisplay === v}
                        onChange={() => setBill('taxDisplay', v)} className="accent-emerald-500" />
                      <span className="text-sm text-gray-600">
                        {v === 'none' ? 'None' : 'Print Category-wise Tax (CWT) on bill'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-800 mb-2">Select item price print option in bill print</p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="itemPriceMode" checked={ps.bill.itemPriceMode === 'exclusive'}
                      onChange={() => setBill('itemPriceMode', 'exclusive')} className="accent-emerald-500" />
                    <span className="text-sm text-gray-600">Individual Item price will be shown (without backward tax) on printed bill</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="itemPriceMode" checked={ps.bill.itemPriceMode === 'inclusive'}
                      onChange={() => setBill('itemPriceMode', 'inclusive')} className="accent-emerald-500" />
                    <span className="text-sm text-gray-600">Individual Item price will be shown (including backward tax) on printed bill</span>
                  </label>
                </div>
              </div>

              <ToggleRow label="Show Backward tax on printed bill" checked={ps.bill.showBackwardTax} onChange={v => setBill('showBackwardTax', v)} />
              <ToggleRow
                label="Show Duplicate on a bill in case of multiple prints"
                description="When a bill is re-printed, it would show Duplicate at the top of the bill."
                checked={ps.bill.showDuplicate} onChange={v => setBill('showDuplicate', v)}
              />
              <ToggleRow label="Show Customer paid and return to customer in bill print" checked={ps.bill.showCustomerPayment} onChange={v => setBill('showCustomerPayment', v)} />
              <ToggleRow
                label="Print KOT no on bill as Token no"
                description="If this option is selected then it shows KOT no. on those bills whose KOT's are available."
                checked={ps.bill.showKotAsToken} onChange={v => setBill('showKotAsToken', v)}
              />
              <ToggleRow label="Show addons in bill print" checked={ps.bill.showAddons} onChange={v => setBill('showAddons', v)} />
              <ToggleRow
                label="Merge Duplicate Items"
                description="This setting enables merging same items on bill when printed."
                checked={ps.bill.mergeDuplicateItems} onChange={v => setBill('mergeDuplicateItems', v)}
              />
              <ToggleRow label="Show order barcode on bill print" checked={ps.bill.showOrderBarcode} onChange={v => setBill('showOrderBarcode', v)} />
              <ToggleRow
                label="Display Quantity of ordered items in Bill (ex. Roti 5 + 1 + 2)"
                description="This setting shows item quantity KOT-wise in bill print."
                checked={ps.bill.showQuantityBreakdown} onChange={v => setBill('showQuantityBreakdown', v)}
              />
            </div>
          )}

          {/* Printer Setup */}
          {activeTab === 'printers' && (
            <PrinterSetupTab
              printers={ps.printers}
              onChange={printers => setPs(p => ({ ...p, printers }))}
              onTest={handleTest}
            />
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-60"
          >
            {saveMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
