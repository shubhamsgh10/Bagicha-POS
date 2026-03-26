import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
    taxRate: 18,
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
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your restaurant details and billing preferences</p>
      </div>

      {/* Restaurant Information */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Restaurant Information</CardTitle>
          </div>
          <CardDescription>This information appears on bills and KOT tickets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Restaurant Name *</Label>
            <Input
              value={formData.restaurantName}
              onChange={(e) => set("restaurantName", e.target.value)}
              placeholder="Enter restaurant name"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                value={formData.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={formData.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="restaurant@email.com"
                type="email"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input
              value={formData.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Full restaurant address"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tax & Billing */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Tax & Billing</CardTitle>
          </div>
          <CardDescription>Configure GST, tax rates, and receipt preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>GST Number (GSTIN)</Label>
              <Input
                value={formData.gstNumber}
                onChange={(e) => set("gstNumber", e.target.value)}
                placeholder="22AAAAA0000A1Z5"
              />
            </div>
            <div className="space-y-2">
              <Label>Tax Rate (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={formData.taxRate}
                onChange={(e) => set("taxRate", parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency Code</Label>
              <Input
                value={formData.currency}
                onChange={(e) => set("currency", e.target.value)}
                placeholder="INR"
              />
            </div>
            <div className="space-y-2">
              <Label>Currency Symbol</Label>
              <Input
                value={formData.currencySymbol}
                onChange={(e) => set("currencySymbol", e.target.value)}
                placeholder="₹"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Bill Footer Note</Label>
            <Input
              value={formData.footerNote}
              onChange={(e) => set("footerNote", e.target.value)}
              placeholder="Thank you for dining with us!"
            />
            <p className="text-xs text-muted-foreground">This message will appear at the bottom of every printed bill</p>
          </div>
        </CardContent>
      </Card>

      {/* POS Access Control */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">POS Access Control</CardTitle>
          </div>
          <CardDescription>
            Configure how long elevated roles (Manager / Admin) stay active on the POS before auto-reverting
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Auto-revert elevated role after</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 0,  label: "Never"   },
                { value: 1,  label: "1 min"   },
                { value: 2,  label: "2 min"   },
                { value: 5,  label: "5 min"   },
                { value: 10, label: "10 min"  },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set("posRoleTimeout", opt.value)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    formData.posRoleTimeout === opt.value
                      ? "bg-primary text-white border-primary"
                      : "border-gray-200 text-gray-600 hover:border-primary hover:text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              When a manager or admin elevates their role on the POS, it will automatically revert back after this time.
              Set to <strong>Never</strong> to require manual lock only.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : "Save Settings"}
        </Button>
      </div>
    </div>
    </div>
  );
}
