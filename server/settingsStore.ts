import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "restaurant-settings.json");

export interface RestaurantSettings {
  restaurantName: string;
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  taxRate: number;
  currency: string;
  currencySymbol: string;
  footerNote: string;
  posRoleTimeout: number; // minutes before elevated role reverts to staff; 0 = never
}

const DEFAULT_SETTINGS: RestaurantSettings = {
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
};

export function getSettings(): RestaurantSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Partial<RestaurantSettings>): RestaurantSettings {
  const current = getSettings();
  const updated = { ...current, ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
