import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Store, Receipt, ShieldCheck } from "lucide-react";

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

export default function Settings() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
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
    if (settings) setFormData(prev => ({ ...prev, ...settings }));
  }, [settings]);

  const set = (key: keyof RestaurantSettings, value: any) =>
    setFormData(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings", formData);
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Restaurant settings updated successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
        <div className="p-6 max-w-3xl mx-auto space-y-5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-white/40 border border-white/30 backdrop-blur-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const sectionCard = "rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <div className="p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Configure your restaurant details and billing preferences</p>
        </div>

        {/* Restaurant Information */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={sectionCard}
        >
          <div className="flex items-center gap-2 mb-1">
            <Store className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-gray-800">Restaurant Information</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">This information appears on bills and KOT tickets</p>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Restaurant Name *</Label>
              <Input
                value={formData.restaurantName}
                onChange={(e) => set("restaurantName", e.target.value)}
                placeholder="Enter restaurant name"
                className="bg-white/60 border-white/50 backdrop-blur-sm"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Phone Number</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98765 43210"
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Email</Label>
                <Input
                  value={formData.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="restaurant@email.com"
                  type="email"
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Address</Label>
              <Input
                value={formData.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Full restaurant address"
                className="bg-white/60 border-white/50 backdrop-blur-sm"
              />
            </div>
          </div>
        </motion.div>

        {/* Tax & Billing */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={sectionCard}
        >
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-gray-800">Tax & Billing</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">Configure GST, tax rates, and receipt preferences</p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">GST Number (GSTIN)</Label>
                <Input
                  value={formData.gstNumber}
                  onChange={(e) => set("gstNumber", e.target.value)}
                  placeholder="22AAAAA0000A1Z5"
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Tax Rate (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.taxRate}
                  onChange={(e) => set("taxRate", parseFloat(e.target.value) || 0)}
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Currency Code</Label>
                <Input
                  value={formData.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  placeholder="INR"
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Currency Symbol</Label>
                <Input
                  value={formData.currencySymbol}
                  onChange={(e) => set("currencySymbol", e.target.value)}
                  placeholder="₹"
                  className="bg-white/60 border-white/50 backdrop-blur-sm"
                />
              </div>
            </div>

            <Separator className="bg-white/40" />

            <div className="space-y-1.5">
              <Label className="text-sm">Bill Footer Note</Label>
              <Input
                value={formData.footerNote}
                onChange={(e) => set("footerNote", e.target.value)}
                placeholder="Thank you for dining with us!"
                className="bg-white/60 border-white/50 backdrop-blur-sm"
              />
              <p className="text-xs text-gray-400">This message will appear at the bottom of every printed bill</p>
            </div>
          </div>
        </motion.div>

        {/* POS Access Control */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className={sectionCard}
        >
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-gray-800">POS Access Control</h2>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Configure how long elevated roles (Manager / Admin) stay active on the POS before auto-reverting
          </p>

          <div className="space-y-3">
            <Label className="text-sm">Auto-revert elevated role after</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 0,  label: "Never"  },
                { value: 1,  label: "1 min"  },
                { value: 2,  label: "2 min"  },
                { value: 5,  label: "5 min"  },
                { value: 10, label: "10 min" },
              ].map((opt) => (
                <motion.button
                  key={opt.value}
                  type="button"
                  whileTap={{ scale: 0.95 }}
                  onClick={() => set("posRoleTimeout", opt.value)}
                  className={`px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                    formData.posRoleTimeout === opt.value
                      ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white border-emerald-500 shadow-sm"
                      : "bg-white/60 border-white/50 text-gray-600 hover:bg-white/80 hover:border-emerald-300"
                  }`}
                >
                  {opt.label}
                </motion.button>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              When a manager or admin elevates their role on the POS, it will automatically revert back after this time.
              Set to <strong>Never</strong> to require manual lock only.
            </p>
          </div>
        </motion.div>

        <div className="flex justify-end pb-6">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold
                       bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm
                       hover:shadow-emerald-400/40 hover:shadow-md transition-all disabled:opacity-60"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : "Save Settings"}
          </motion.button>
        </div>
      </div>
    </div>
  );
}
