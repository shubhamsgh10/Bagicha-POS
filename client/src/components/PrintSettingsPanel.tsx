import { apiUrl } from '@/lib/api';
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Wifi, Usb, TestTube2, CheckCircle2, X, ScanLine } from "lucide-react";
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
  windowsQueueName?: string;
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
  autoKOTPrint: boolean;
  autoKOTDebounceMs: number;
  kotNumbering: boolean;
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
  showLogo: boolean;
  showFssai: boolean;
  showRoundOff: boolean;
  showNameField: boolean;
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
  autoKOTPrint: false, autoKOTDebounceMs: 1500,
  kotNumbering: true,
};

const DEFAULT_BILL: BillPrintSettings = {
  taxDisplay: 'none', itemPriceMode: 'exclusive', showBackwardTax: true,
  showDuplicate: true, showCustomerPayment: false, showKotAsToken: false,
  showAddons: true, mergeDuplicateItems: true, showOrderBarcode: false,
  showQuantityBreakdown: false, billPrinterId: null,
  showLogo: true, showFssai: false, showRoundOff: true, showNameField: true,
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

// ── KOT Receipt Preview ───────────────────────────────────────────────────────

function KOTReceiptPreview({ kot }: { kot: KOTPrintSettings }) {
  return (
    <div style={{
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: 11, lineHeight: 1.65, background: '#fff',
      border: '1px solid #ccc', padding: '12px 10px',
      width: '100%', maxWidth: 280, color: '#000',
      boxShadow: '1px 2px 6px rgba(0,0,0,0.1)',
    }}>
      <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>TABLE - 4</div>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>KITCHEN ORDER</div>
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
      {kot.kotNumbering !== false && (
        <div>KOT#: 001&nbsp;&nbsp;&nbsp;22/03/26&nbsp;&nbsp;&nbsp;19:26</div>
      )}
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div><strong>{'[ 02 ]'}&nbsp;&nbsp;Butter Naan</strong></div>
      {kot.printAddons && <div style={{ paddingLeft: 8, fontSize: 10 }}>{'>> No Onion, Less Spice'}</div>}
      <div><strong>{'[ 01 ]'}&nbsp;&nbsp;Dal Makhani</strong></div>
      <div><strong>{'[ 01 ]'}&nbsp;&nbsp;Paneer Tikka</strong></div>
      {kot.printAddons && <div style={{ paddingLeft: 8, fontSize: 10 }}>{'>> Extra Gravy'}</div>}
      {kot.printCancelledKOT && (
        <>
          <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
          <div><strong>** VOID **&nbsp;&nbsp;{'[ 01 ]'}&nbsp;&nbsp;Masala Chai</strong></div>
        </>
      )}
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
      <div style={{ textAlign: 'center', fontWeight: 700 }}>Total Items: 4</div>
      <div style={{ borderTop: '2px solid #000', margin: '5px 0' }} />
    </div>
  );
}

// ── Bill Receipt Preview ───────────────────────────────────────────────────────

function BillReceiptPreview({ bill, settings }: { bill: BillPrintSettings; settings: any }) {
  const taxRate  = settings?.taxRate ?? 5;
  const cgst     = taxRate / 2;
  const subtotal = 270.00;
  const taxAmt   = subtotal * taxRate / 100;
  const rawTotal = subtotal + taxAmt;
  const rounded  = Math.round(rawTotal);
  const roundOff = rounded - rawTotal;
  const sym      = settings?.currencySymbol || '₹';

  return (
    <div style={{
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: 11, lineHeight: 1.65, background: '#fff',
      border: '1px solid #ccc', padding: '12px 10px',
      width: '100%', maxWidth: 280, color: '#000',
      boxShadow: '1px 2px 6px rgba(0,0,0,0.1)',
    }}>
      {bill.showLogo && (
        <div style={{ textAlign: 'center', fontSize: 9, color: '#888', border: '1px dashed #ccc', padding: 3, marginBottom: 5 }}>
          [LOGO — from printer NV Flash]
        </div>
      )}
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{settings?.restaurantName || 'Restaurant Name'}</div>
      {settings?.businessName && <div style={{ textAlign: 'center' }}>{settings.businessName}</div>}
      {settings?.gstNumber && <div style={{ textAlign: 'center' }}>GST -{settings.gstNumber}</div>}
      {settings?.phone && <div style={{ textAlign: 'center' }}>M - {settings.phone}</div>}
      {settings?.address && settings.address.split(',').map((p: string, i: number) => (
        <div key={i} style={{ textAlign: 'center' }}>{p.trim()}</div>
      ))}
      {bill.showFssai && settings?.fssaiNumber && (
        <div style={{ textAlign: 'center' }}>FSSAI: {settings.fssaiNumber}</div>
      )}
      <div style={{ borderTop: '1px solid #000', margin: '5px 0' }} />
      {bill.showNameField && <><div>Name:{'_'.repeat(22)}</div><br /></>}
      <div>Date: 22/03/26&nbsp;&nbsp;&nbsp;<strong>Pick Up</strong></div>
      <div>19:26</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Cashier: Admin</span><span>Bill No.: 1234</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div style={{ fontWeight: 700, display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Item</span>
        <span style={{ width: 24, textAlign: 'right' }}>Qty</span>
        <span style={{ width: 54, textAlign: 'right' }}>Price</span>
        <span style={{ width: 48, textAlign: 'right' }}>Amt</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '3px 0' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Butter Naan</span>
        <span style={{ width: 24, textAlign: 'right' }}>2</span>
        <span style={{ width: 54, textAlign: 'right' }}>90.00</span>
        <span style={{ width: 48, textAlign: 'right' }}>180.00</span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <span style={{ flex: 1 }}>Dal Makhani</span>
        <span style={{ width: 24, textAlign: 'right' }}>1</span>
        <span style={{ width: 54, textAlign: 'right' }}>90.00</span>
        <span style={{ width: 48, textAlign: 'right' }}>90.00</span>
      </div>
      <div style={{ borderTop: '1px dashed #666', margin: '4px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Total Qty: 3</span>
        <span>Sub Total {subtotal.toFixed(2)}</span>
      </div>
      <div style={{ textAlign: 'right' }}>CGST {cgst}%&nbsp;&nbsp;{(taxAmt / 2).toFixed(2)}</div>
      <div style={{ textAlign: 'right' }}>SGST {cgst}%&nbsp;&nbsp;{(taxAmt / 2).toFixed(2)}</div>
      {bill.showRoundOff && Math.abs(roundOff) >= 0.005 && (
        <div style={{ textAlign: 'right' }}>Round off&nbsp;&nbsp;{roundOff.toFixed(2)}</div>
      )}
      <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
      <div style={{ textAlign: 'right', fontWeight: 700 }}>Grand Total {sym}{rounded.toFixed(2)}</div>
      <div style={{ borderTop: '1px solid #000', margin: '4px 0' }} />
      <div style={{ textAlign: 'center' }}>{settings?.footerNote || 'Thanks'}</div>
    </div>
  );
}

// ── Printer Setup Tab ─────────────────────────────────────────────────────────

interface USBDeviceInfo {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  displayName?: string;
  isLikelyPrinter?: boolean;
  windowsQueueName?: string;
}

function usbDeviceLabel(d: USBDeviceInfo): string {
  return d.displayName ?? d.productName ?? d.manufacturerName ?? 'USB Device';
}

/** Windows USBPRINT queues often share VID/PID 0 — use queue name as the stable id. */
function usbDeviceKey(d: USBDeviceInfo): string {
  if (d.windowsQueueName?.trim()) return `queue:${d.windowsQueueName.trim()}`;
  if (d.vendorId > 0 || d.productId > 0) {
    return `usb:${d.vendorId.toString(16)}:${d.productId.toString(16)}`;
  }
  return `name:${usbDeviceLabel(d)}`;
}

function PrinterSetupTab({ printers, onChange, onTest }: {
  printers: PrinterConfig[];
  onChange: (printers: PrinterConfig[]) => void;
  onTest: (printerId: string) => void;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<PrinterConfig>>({ type: 'network', port: 9100, width: 48 });
  const [detectedDevices, setDetectedDevices] = useState<USBDeviceInfo[]>([]);
  const [usbScanning, setUsbScanning] = useState(false);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
  const webUsbSupported = typeof navigator !== 'undefined' && 'usb' in (navigator as any);
  const canScanUsb = isElectron || webUsbSupported;

  /** Each scan replaces the list — never merge by VID/PID (0:0 collides across queues). */
  const applyScanResults = (incoming: USBDeviceInfo[]) => {
    const byKey = new Map<string, USBDeviceInfo>();
    for (const d of incoming) {
      byKey.set(usbDeviceKey(d), d);
    }
    setDetectedDevices(Array.from(byKey.values()));
  };

  const selectDevice = (d: USBDeviceInfo) => {
    const queueName = d.windowsQueueName ?? d.displayName ?? '';
    setForm(f => ({
      ...f,
      vendorId: d.vendorId || undefined,
      productId: d.productId || undefined,
      windowsQueueName: queueName,
      name: f.name?.trim() ? f.name : (usbDeviceLabel(d) || 'USB Printer'),
    }));
  };

  const scanUsbElectron = async () => {
    if (!window.electronAPI?.scanUsbDevices) return;
    setUsbScanning(true);
    try {
      const result = await window.electronAPI.scanUsbDevices();
      if (!result.ok) {
        throw new Error(result.error ?? 'USB scan failed');
      }
      const devices = result.devices ?? [];
      applyScanResults(devices);
      if (devices.length === 0) {
        toast({
          title: 'No printers found',
          description:
            'Plug in the thermal printer, confirm it appears in Windows Settings → Printers, then scan again.',
        });
      } else {
        const thermal = devices.filter(d => d.isLikelyPrinter);
        if (thermal.length === 1) {
          selectDevice(thermal[0]);
        }
      }
    } catch (err: any) {
      toast({
        title: 'USB scan failed',
        description: err?.message ?? String(err),
        variant: 'destructive',
      });
    } finally {
      setUsbScanning(false);
    }
  };

  useEffect(() => {
    if (form.type !== 'usb') return;
    if (isElectron) {
      void scanUsbElectron();
      return;
    }
    if (!webUsbSupported) return;
    (navigator as any).usb.getDevices().then((devices: USBDeviceInfo[]) => setDetectedDevices(devices));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scan on tab switch only
  }, [form.type, isElectron, webUsbSupported]);

  const scanUsbPrinter = async () => {
    if (isElectron) {
      await scanUsbElectron();
      return;
    }
    try {
      const device: USBDeviceInfo = await (navigator as any).usb.requestDevice({ filters: [] });
      applyScanResults([device]);
      setForm(f => ({
        ...f,
        vendorId: device.vendorId,
        productId: device.productId,
        name: f.name?.trim() ? f.name : (usbDeviceLabel(device) || 'USB Printer'),
      }));
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        toast({
          title: 'WebUSB scan failed',
          description: err?.message ?? String(err),
          variant: 'destructive',
        });
      }
    }
  };

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
      windowsQueueName: form.windowsQueueName,
      width: form.width ?? 32,
    };
    onChange([...printers, newPrinter]);
    setAdding(false);
    setForm({ type: 'network', port: 9100, width: 48 });
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
        <div key={p.id} className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2">
          <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Paper width:</label>
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-emerald-400"
              value={p.width ?? 48}
              onChange={e => onChange(printers.map(pr => pr.id === p.id ? { ...pr, width: parseInt(e.target.value) } : pr))}
            >
              <option value={32}>32 chars — 58mm paper</option>
              <option value={48}>48 chars — 80mm paper</option>
            </select>
            <span className="text-xs text-amber-600 font-medium">
              {(p.width ?? 48) === 32 ? '⚠ Change to 80mm if your printer is 80mm wide' : ''}
            </span>
          </div>
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
              {/* Previously-granted devices — shown without any user prompt */}
              {detectedDevices.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Detected devices</p>
                  {detectedDevices.map((d) => (
                    <button
                      key={usbDeviceKey(d)}
                      type="button"
                      onClick={() => selectDevice(d)}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                        (d.windowsQueueName && form.windowsQueueName === d.windowsQueueName) ||
                        (d.vendorId > 0 && d.productId > 0 &&
                          form.vendorId === d.vendorId && form.productId === d.productId)
                          ? 'bg-purple-50 border-purple-300 text-purple-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Usb className="w-3 h-3 shrink-0 text-purple-400" />
                      <span className="font-medium truncate">{usbDeviceLabel(d)}</span>
                      {d.isLikelyPrinter && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-purple-600 bg-purple-100 px-1.5 py-0.5 rounded">
                          Printer
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-gray-400 font-mono truncate max-w-[40%]">
                        {d.vendorId > 0 || d.productId > 0
                          ? `0x${d.vendorId.toString(16).padStart(4, '0')}:0x${d.productId.toString(16).padStart(4, '0')}`
                          : (d.windowsQueueName ?? 'USB queue')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {canScanUsb && (
                <button
                  type="button"
                  onClick={scanUsbPrinter}
                  disabled={usbScanning}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors disabled:opacity-60"
                >
                  {usbScanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ScanLine className="w-3.5 h-3.5" />
                  )}
                  {usbScanning ? 'Scanning…' : 'Scan / Detect USB Printer'}
                </button>
              )}

              {/* Manual VID/PID entry — always shown as fallback */}
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
                {isElectron
                  ? 'Scan lists installed Windows printer queues (USB). Pick your receipt/thermal printer — not LaserJet or camera devices.'
                  : webUsbSupported
                    ? 'Click "Scan" to auto-detect your USB printer VID/PID.'
                    : 'USB auto-detect requires Chrome, Edge, or the Bagicha desktop app. Enter VID/PID manually.'}
              </p>
            </>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Paper width:</label>
            <select
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none"
              value={form.width ?? 48}
              onChange={e => setForm(f => ({ ...f, width: parseInt(e.target.value) }))}
            >
              <option value={32}>32 chars (58mm paper)</option>
              <option value={48}>48 chars (80mm paper)</option>
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setAdding(false); setForm({ type: 'network', port: 9100, width: 48 }); }}
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
            onClick={() => {
              setDetectedDevices([]);
              setAdding(true);
            }}
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
      const res = await apiRequest('PUT', '/api/settings', { ...currentSettings, printSettings: ps });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/settings'], data);
      toast({ title: 'Print settings saved' });
      if (window.electronAPI?.isElectron) window.electronAPI.refreshPrinters?.();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleTest = async (printerId: string) => {
    try {
      const res = await fetch(apiUrl('/api/print/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerId }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      if (data.printJob && window.electronAPI?.isElectron) {
        const result = await window.electronAPI.printTest({
          printerId,
          printJob: data.printJob,
        });
        if (!result.ok) throw new Error(result.error ?? 'Test print failed');
      } else {
        const { handlePrintResponse } = await import('@/lib/printGateway');
        const outcome = await handlePrintResponse(data);
        if (outcome === 'noop' && data.printJob) {
          throw new Error('Thermal test print requires the Electron desktop app.');
        }
      }
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

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col justify-end sm:items-center sm:justify-center bg-black/50 sm:bg-black/40 sm:px-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid rgba(0,0,0,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 shrink-0">
          <div className="w-9 h-1 rounded-full bg-gray-300" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-800">Print Settings</h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure thermal printer behavior</p>
          </div>
          <button onClick={onClose} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors touch-manipulation">
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
                label="Auto Print KOT on Item Add"
                description="Automatically sends KOT to kitchen when items are added or modified. Only new/changed items are printed (delta logic). Requires a KOT printer to be configured."
                checked={ps.kot.autoKOTPrint}
                onChange={v => setKot('autoKOTPrint', v)}
              />
              {ps.kot.autoKOTPrint && (
                <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">Auto KOT Delay</p>
                    <p className="text-xs text-gray-400 mt-0.5">Combines rapid item additions into a single KOT print</p>
                  </div>
                  <select
                    className={selectCls}
                    value={ps.kot.autoKOTDebounceMs}
                    onChange={e => setKot('autoKOTDebounceMs', Number(e.target.value))}
                  >
                    <option value={500}>0.5 s</option>
                    <option value={1000}>1 s</option>
                    <option value={1500}>1.5 s</option>
                    <option value={2000}>2 s</option>
                    <option value={3000}>3 s</option>
                  </select>
                </div>
              )}
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
              <ToggleRow
                label="While moving KOT items from one table to another, print KOT"
                checked={ps.kot.printOnTableMove} onChange={v => setKot('printOnTableMove', v)}
              />
              <ToggleRow
                label="Show KOT Number"
                description="Prints KOT#: 001 with date and time on each KOT slip."
                checked={ps.kot.kotNumbering !== false}
                onChange={v => setKot('kotNumbering', v)}
              />

              <div className="mt-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Print Preview</p>
                <KOTReceiptPreview kot={ps.kot} />
              </div>
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
              <ToggleRow
                label="Print Logo from Printer NV Flash"
                description="Prints the logo stored in the printer's NV Flash memory slot 1. Set up once via TVS utility tool."
                checked={ps.bill.showLogo}
                onChange={v => setBill('showLogo', v)}
              />
              <ToggleRow
                label="Show FSSAI License Number"
                description="Prints FSSAI number below GST in the bill header. Enter the number in Settings → Restaurant Configuration."
                checked={ps.bill.showFssai}
                onChange={v => setBill('showFssai', v)}
              />
              <ToggleRow
                label="Show Round Off Line"
                description="Prints the round-off adjustment line (e.g. -0.36) above Grand Total."
                checked={ps.bill.showRoundOff}
                onChange={v => setBill('showRoundOff', v)}
              />
              <ToggleRow
                label="Show Name Field"
                description="Prints a blank Name:___ line at the top of the bill for handwriting the customer name."
                checked={ps.bill.showNameField}
                onChange={v => setBill('showNameField', v)}
              />

              <div className="mt-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Print Preview</p>
                <BillReceiptPreview bill={ps.bill} settings={currentSettings} />
              </div>
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
        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50/60">
          <button
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-5 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors touch-manipulation"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-60 touch-manipulation"
          >
            {saveMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
