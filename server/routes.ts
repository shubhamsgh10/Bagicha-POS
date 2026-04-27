import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "child_process";
import { storage } from "./storage";
import { z } from "zod";
import { insertOrderItemSchema, insertKotTicketSchema, insertCategorySchema, insertInventorySchema, insertOrderSchema } from "@shared/schema";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import crypto from "crypto";
import { getSettings, saveSettings } from "./settingsStore";
import { getLogBuffer } from "./vite";
import {
  getAutomationConfig,
  saveAutomationConfig,
  loadLogs,
  clearLogs,
  getAutomationStats,
  setCustomerPref,
  loadCustomerPrefs,
} from "./services/automationStore";
import {
  runCustomerAutomation,
  restartScheduler,
} from "./services/customerAutomationService";

// ── CRM Services (Phase 2–9 additions) ────────────────────────────────────────
import {
  resolveCustomerId,
  getCustomerMaster,
  getCustomerProfile,
  upsertCustomerProfile,
  syncLocalStorageExtras,
  dbProfileToExtra,
} from "./services/crm/customerIdService";
import {
  getCustomerEvents,
  logOrderPlaced,
} from "./services/crm/eventService";
import {
  runSegmentationForCustomer,
  runSegmentationForAll,
  getCustomerSegment,
} from "./services/crm/segmentationService";
import { getRecommendations } from "./services/crm/recommendationService";
import { sendMessage, getCustomerMessages } from "./services/crm/messagingService";
import { runAutomationServerSide } from "./services/crm/automationRuleEngine";
import { db } from "./db";
import { registerPrintRoutes } from "./printRoutes";
import { automationRules, automationJobs, customerMessages, categories, menuItems, inventory, customersMaster, customerProfiles } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { registerPublicGrowthRoutes, registerGrowthRoutes } from "./growthRoutes";
import { registerStaffRoutes } from "./staffRoutes";
import { earnPointsForOrder } from "./services/loyaltyService";
import { scheduleFeedbackForOrder } from "./services/feedbackService";

// Password hashing helpers using Node's built-in crypto
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(`${salt}:${derived.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(":");
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(key === derived.toString("hex"));
    });
  });
}

// Passport local strategy
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await storage.getUserByUsername(username);
    if (!user) return done(null, false, { message: "Invalid username or password" });
    const valid = await verifyPassword(password, user.password);
    if (!valid) return done(null, false, { message: "Invalid username or password" });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: any, done) => {
  try {
    const user = await storage.getUser(Number(id));
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// Middleware to require authentication
export function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

// Middleware to require admin role
export function requireAdmin(req: any, res: any, next: any) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const broadcast = (data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  };

  // Ensure admin user exists on startup
  try {
    const adminUser = await storage.getUserByUsername("admin");
    if (!adminUser) {
      const hashed = await hashPassword("admin123");
      await storage.createUser({ username: "admin", password: hashed, role: "admin" });
      console.log("Created default admin user (username: admin, password: admin123)");
    }
  } catch (err: any) {
    if (err.code === 'ENOTFOUND') {
      console.error("\n❌ DATABASE CONNECTION FAILED");
      console.error("   Cannot reach host:", err.hostname);
      console.error("   The Supabase project may be deleted or paused.");
      console.error("   → Create a new project at supabase.com or neon.tech");
      console.error("   → Update DATABASE_URL in your .env file");
      console.error("   → Run: npm run db:push\n");
    } else {
      console.error("Failed to ensure admin user:", err.message || err);
    }
  }

  // ── Auth Routes ──────────────────────────────────────────────────────────────

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.logIn(user, (err) => {
        if (err) return next(err);
        const { password, ...safeUser } = user;
        res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ success: true });
    });
  });

  // ── Device context — tells client if request is from local network + mobile ──
  app.get("/api/auth/context", (req, res) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress
      || "";
    const isLocalNetwork =
      ip === "::1" ||
      ip === "127.0.0.1" ||
      /^::ffff:127\./.test(ip) ||
      /^10\./.test(ip) ||
      /^192\.168\./.test(ip) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

    const ua = req.headers["user-agent"] ?? "";
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

    res.json({ isLocalNetwork, isMobile });
  });

  // ── Staff PIN login — no password, just userId + 4-digit PIN ────────────────
  app.post("/api/auth/staff-pin-login", async (req, res, next) => {
    try {
      const { userId, pin } = req.body;
      if (!userId || !pin) return res.status(400).json({ message: "userId and pin required" });

      const user = await storage.getUser(Number(userId));
      if (!user) return res.status(401).json({ message: "User not found" });
      if (user.role !== "staff") return res.status(403).json({ message: "PIN login is only for staff accounts" });
      if (!user.pin) return res.status(401).json({ message: "No PIN set for this user. Ask your manager to set one." });
      if (user.pin !== String(pin)) return res.status(401).json({ message: "Wrong PIN" });

      req.logIn(user, (err) => {
        if (err) return next(err);
        const { password, pin: _pin, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
    const user = req.user as any;
    const { password, ...safeUser } = user;
    res.json(safeUser);
  });

  app.put("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { username } = req.body;
      if (!username || typeof username !== "string" || username.trim().length === 0) {
        return res.status(400).json({ message: "Username is required" });
      }
      const currentUser = req.user as any;
      const existing = await storage.getUserByUsername(username.trim());
      if (existing && existing.id !== currentUser.id) {
        return res.status(409).json({ message: "Username already taken" });
      }
      const updated = await storage.updateUser(Number(currentUser.id), { username: username.trim() });
      const { password, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err) {
      console.error("Profile update error:", err);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.put("/api/auth/password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password are required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      const currentUser = req.user as any;
      const user = await storage.getUser(Number(currentUser.id));
      if (!user) return res.status(404).json({ message: "User not found" });
      const valid = await verifyPassword(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      const hashed = await hashPassword(newPassword);
      await storage.updateUser(Number(currentUser.id), { password: hashed });
      res.json({ success: true });
    } catch (err) {
      console.error("Password change error:", err);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // ── PIN verification ──────────────────────────────────────────────────────────

  // Returns which roles have at least one user with a PIN set
  app.get("/api/auth/switchable-roles", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      const rolesWithPin = Array.from(new Set(allUsers.filter((u) => u.pin).map((u) => u.role)));
      res.json({ roles: rolesWithPin });
    } catch (err) {
      res.status(500).json({ roles: [] });
    }
  });

  app.post("/api/auth/verify-pin", requireAuth, async (req, res) => {
    try {
      const { pin, requiredRole } = req.body;
      if (!pin) return res.status(400).json({ valid: false });
      const allUsers = await storage.getUsers();

      // Role hierarchy for PIN acceptance:
      // Switching to "admin"   → only admin PIN accepted
      // Switching to "manager" → manager OR admin PIN accepted
      // Any other role         → that role's PIN OR any higher role's PIN accepted
      const ROLE_LEVEL: Record<string, number> = {
        staff: 0, cashier: 0, kitchen: 0, manager: 1, admin: 2,
      };
      const targetLevel = ROLE_LEVEL[requiredRole] ?? 1;
      const match = allUsers.find(
        (u) => (ROLE_LEVEL[u.role] ?? 0) >= targetLevel && u.pin === String(pin)
      );
      res.json({ valid: !!match });
    } catch (err) {
      console.error("Verify PIN error:", err);
      res.status(500).json({ valid: false });
    }
  });

  // Reset all PINs (admin only)
  app.post("/api/users/reset-all-pins", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      await Promise.all(allUsers.map((u) => storage.updateUser(u.id, { pin: null })));
      res.json({ success: true });
    } catch (err) {
      console.error("Reset all PINs error:", err);
      res.status(500).json({ message: "Failed to reset PINs" });
    }
  });


  // Update PIN for a user (admin sets PIN for managers)
  app.put("/api/users/:id/pin", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { pin } = req.body;
      if (pin && !/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ message: "PIN must be 4-6 digits" });
      }
      const updated = await storage.updateUser(id, { pin: pin ? String(pin) : null });
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
    } catch (err) {
      console.error("Update PIN error:", err);
      res.status(500).json({ message: "Failed to update PIN" });
    }
  });

  // ── User Management (Admin only) ──────────────────────────────────────────────

  app.get("/api/users", requireAuth, async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      const safeUsers = allUsers.map(({ password, pin, ...u }) => ({ ...u, pin: !!pin }));
      res.json(safeUsers);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role, pin } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ message: "PIN must be 4 or 6 digits" });
      const existing = await storage.getUserByUsername(username.trim());
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const hashed = await hashPassword(password);
      const user = await storage.createUser({
        username: username.trim(),
        password: hashed,
        role: role || "staff",
        pin: pin ? String(pin) : null,
      });
      const { password: _, pin: userPin, ...safeUser } = user;
      res.json({ ...safeUser, pin: !!userPin });
    } catch (err) {
      console.error("Create user error:", err);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.put("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { role, username, password, pin } = req.body;
      const updateData: any = {};
      if (role) updateData.role = role;
      if (pin !== undefined) {
        if (pin && !/^\d{4,6}$/.test(String(pin))) {
          return res.status(400).json({ message: "PIN must be 4-6 digits" });
        }
        updateData.pin = pin ? String(pin) : null;
      }
      if (username) {
        const existing = await storage.getUserByUsername(username.trim());
        if (existing && existing.id !== id) return res.status(409).json({ message: "Username already taken" });
        updateData.username = username.trim();
      }
      if (password) {
        if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
        updateData.password = await hashPassword(password);
      }
      const updated = await storage.updateUser(id, updateData);
      const { password: _, pin: updatedPin, ...safeUser } = updated;
      res.json({ ...safeUser, pin: !!updatedPin });
    } catch (err) {
      console.error("Update user error:", err);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user as any;
      if (id === currentUser.id) return res.status(400).json({ message: "Cannot delete your own account" });
      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ── Database migration ────────────────────────────────────────────────────────

  app.post("/api/admin/migrate", requireAdmin, (_req, res) => {
    const child = spawn("npx", ["drizzle-kit", "push", "--force"], {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
    });

    let output = "";
    child.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { output += d.toString(); });

    child.on("close", (code: number) => {
      if (code === 0) {
        res.json({ success: true, output });
      } else {
        res.status(500).json({ message: "Migration failed", output });
      }
    });

    child.on("error", (err: Error) => {
      res.status(500).json({ message: err.message });
    });
  });

  // ── Server logs ───────────────────────────────────────────────────────────────

  app.get("/api/admin/logs", requireAdmin, (_req, res) => {
    res.json(getLogBuffer());
  });

  // ── Data import ───────────────────────────────────────────────────────────────

  app.post("/api/admin/import/menu", requireAdmin, async (req, res) => {
    const rows: { name: string; category: string; price: string; description?: string }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: number[] = [];
    const errors: string[] = [];

    // Build category name→id cache (case-insensitive)
    const existingCats = await db.select().from(categories);
    const catCache = new Map<string, number>(existingCats.map(c => [c.name.toLowerCase(), c.id]));

    for (const row of rows) {
      try {
        const catName = row.category?.trim() || "Uncategorised";
        let catId = catCache.get(catName.toLowerCase());
        if (!catId) {
          const [newCat] = await db.insert(categories).values({ name: catName, isActive: true, displayOrder: 0 }).returning();
          catId = newCat.id;
          catCache.set(catName.toLowerCase(), catId);
        }
        const price = parseFloat(row.price);
        if (isNaN(price) || price < 0) throw new Error(`Invalid price "${row.price}"`);
        const [item] = await db.insert(menuItems).values({
          name: row.name.trim(),
          description: row.description?.trim() || null,
          price: price.toFixed(2),
          categoryId: catId,
          isAvailable: true,
          preparationTime: 15,
        }).returning();
        imported.push(item.id);
      } catch (err: any) {
        errors.push(`"${row.name}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  app.post("/api/admin/import/inventory", requireAdmin, async (req, res) => {
    const rows: { itemName: string; currentStock: string; minStock: string; unit: string }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: number[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const current = parseFloat(row.currentStock);
        const min     = parseFloat(row.minStock);
        if (isNaN(current) || isNaN(min)) throw new Error("Invalid stock value");
        const [item] = await db.insert(inventory).values({
          itemName:     row.itemName.trim(),
          currentStock: current.toFixed(2),
          minStock:     min.toFixed(2),
          unit:         row.unit?.trim() || "pcs",
        }).returning();
        imported.push(item.id);
      } catch (err: any) {
        errors.push(`"${row.itemName}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  app.post("/api/admin/import/customers", requireAdmin, async (req, res) => {
    const rows: {
      name: string; phone?: string; email?: string; address?: string;
      locality?: string; dob?: string; anniversary?: string; tags?: string; remark?: string;
    }[] = req.body.rows ?? [];
    if (!rows.length) return res.status(400).json({ message: "No rows provided" });

    const imported: string[] = [];
    const errors: string[] = [];

    // Build phone/name → existing customer id cache to skip duplicates
    const existingCustomers = await db.select({ id: customersMaster.id, key: customersMaster.key }).from(customersMaster);
    const existingKeys = new Set(existingCustomers.map(c => c.key.toLowerCase()));

    for (const row of rows) {
      const name = row.name?.trim();
      if (!name) { errors.push("Row skipped: Name is required"); continue; }

      const phone = row.phone?.trim().replace(/\D/g, "") || undefined;
      const key   = phone || name;

      if (existingKeys.has(key.toLowerCase())) {
        errors.push(`"${name}": already exists (skipped)`);
        continue;
      }

      try {
        const [master] = await db.insert(customersMaster).values({ key, name, phone: phone || null }).returning();

        const tags = row.tags
          ? row.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean)
          : [];

        await db.insert(customerProfiles).values({
          customerId:          master.id,
          email:               row.email?.trim()       || null,
          address:             row.address?.trim()     || null,
          locality:            row.locality?.trim()    || null,
          dob:                 row.dob?.trim()         || null,
          anniversary:         row.anniversary?.trim() || null,
          tags:                tags.length ? tags : null,
          remark:              row.remark?.trim()      || null,
          isFavorite:          false,
          notificationEnabled: true,
          doNotSendUpdate:     false,
        });

        existingKeys.add(key.toLowerCase());
        imported.push(master.id);
      } catch (err: any) {
        errors.push(`"${name}": ${err.message}`);
      }
    }

    res.json({ imported: imported.length, errors });
  });

  // ── Print routes ──────────────────────────────────────────────────────────────
  registerPrintRoutes(app);

  // ── Phase 1 growth routes (Razorpay, Coupons, Loyalty, Feedback, Digest) ─────
  registerPublicGrowthRoutes(app);
  registerGrowthRoutes(app, broadcast);

  // ── Staff management + attendance routes ──────────────────────────────────
  registerStaffRoutes(app);

  // ── Settings ──────────────────────────────────────────────────────────────────

  app.get("/api/settings", requireAuth, (req, res) => {
    try {
      res.json(getSettings());
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", requireAdmin, (req, res) => {
    try {
      const updated = saveSettings(req.body);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  // ── Dashboard Stats ───────────────────────────────────────────────────────────

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  app.get("/api/dashboard/sales-chart", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end   = endDate   ? new Date(endDate   as string) : undefined;
      const data = await storage.getSalesChart(start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sales chart" });
    }
  });

  app.get("/api/dashboard/category-sales", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end   = endDate   ? new Date(endDate   as string) : undefined;
      const data = await storage.getCategorySales(start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch category sales" });
    }
  });

  app.get("/api/dashboard/top-items", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end   = endDate   ? new Date(endDate   as string) : undefined;
      const data = await storage.getDashboardTopItems(8, start, end);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch top items" });
    }
  });

  // ── Categories ────────────────────────────────────────────────────────────────

  app.get("/api/categories", requireAuth, async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", requireAuth, async (req, res) => {
    try {
      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: "Invalid category data" });
    }
  });

  app.put("/api/categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Name is required" });
      const updated = await storage.updateCategory(id, { name, description });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCategory(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  app.put("/api/categories/reorder", requireAuth, async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });
      await storage.reorderCategories(orderedIds.map(Number));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reorder categories" });
    }
  });

  // ── Live Status ──────────────────────────────────────────────────────────────

  app.get("/api/live-status", requireAuth, async (req, res) => {
    try {
      const allTables = await storage.getTables();
      const runningTables = allTables.filter(t => t.status === "running").length;
      const freeTables    = allTables.filter(t => t.status === "free").length;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const allOrders = await storage.getOrders();
      const activeOrders = allOrders.filter(
        o => o.status !== "served" && o.status !== "cancelled"
      ).length;
      const todaySales = allOrders
        .filter(o => {
          const d = new Date(o.createdAt);
          return d >= today && d < tomorrow;
        })
        .reduce((sum, o) => sum + parseFloat(o.totalAmount as string), 0);

      res.json({ runningTables, freeTables, activeOrders, todaySales });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch live status" });
    }
  });

  // ── Tables ───────────────────────────────────────────────────────────────────

  app.get("/api/tables", requireAuth, async (req, res) => {
    try {
      const allTables = await storage.getTables();
      res.json(allTables);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tables" });
    }
  });

  app.post("/api/tables", requireAuth, async (req, res) => {
    try {
      const { name, capacity, section } = req.body;
      if (!name) return res.status(400).json({ error: "Table name is required" });
      const table = await storage.createTable({
        name: String(name).trim(),
        capacity: Number(capacity) || 4,
        section: String(section || "inner"),
      });
      res.json(table);
    } catch (error) {
      res.status(500).json({ error: "Failed to create table" });
    }
  });

  app.put("/api/tables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, capacity, section } = req.body;
      const data: any = {};
      if (name !== undefined) data.name = String(name).trim();
      if (capacity !== undefined) data.capacity = Number(capacity);
      if (section !== undefined) data.section = String(section);
      const table = await storage.updateTable(id, data);
      res.json(table);
    } catch (error) {
      res.status(500).json({ error: "Failed to update table" });
    }
  });

  app.delete("/api/tables/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTable(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete table" });
    }
  });

  app.post("/api/tables/:id/shift", requireAuth, async (req, res) => {
    try {
      const fromTableId = parseInt(req.params.id);
      const { toTableId } = req.body;
      if (!toTableId) return res.status(400).json({ error: "toTableId is required" });
      const fromTable = await storage.getTableById(fromTableId);
      if (!fromTable || !fromTable.currentOrderId) return res.status(400).json({ error: "No active order on this table" });
      const toTable = await storage.getTableById(Number(toTableId));
      if (!toTable) return res.status(400).json({ error: "Target table not found" });
      if (toTable.status !== "free") return res.status(400).json({ error: "Target table is not free" });
      // Move order to new table
      await storage.updateOrder(fromTable.currentOrderId, { tableId: Number(toTableId), tableNumber: toTable.name } as any);
      await storage.updateTableStatus(Number(toTableId), "running", fromTable.currentOrderId);
      await storage.updateTableStatus(fromTableId, "free", null);
      broadcast({ type: 'TABLE_UPDATE' });
      res.json({ success: true });
    } catch (error) {
      console.error("Shift table error:", error);
      res.status(500).json({ error: "Failed to shift table" });
    }
  });

  // ── Menu Items ────────────────────────────────────────────────────────────────

  app.get("/api/menu", requireAuth, async (req, res) => {
    try {
      const menuItems = req.query.all === "true"
        ? await storage.getAllMenuItems()
        : await storage.getMenuItems();
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.get("/api/menu/sold-today", requireAuth, async (req, res) => {
    try {
      const soldToday = await storage.getSoldToday();
      console.log("[sold-today] result:", JSON.stringify(soldToday));
      res.json(soldToday);
    } catch (error) {
      console.error("[sold-today] error:", error);
      res.status(500).json({ error: "Failed to fetch sold today stats" });
    }
  });

  app.get("/api/menu/category/:categoryId", requireAuth, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const menuItems = await storage.getMenuItemsByCategory(categoryId);
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.post("/api/menu", requireAuth, async (req, res) => {
    try {
      const b = req.body;
      if (!b.name || !b.categoryId) {
        return res.status(400).json({ error: "Name and category are required" });
      }
      const addonsEnabled = b.addonsEnabled === true;
      const menuItem = await storage.createMenuItem({
        name: String(b.name).trim(),
        description: b.description ? String(b.description).trim() : null,
        price: String(b.price ?? "0"),
        categoryId: Number(b.categoryId),
        isAvailable: b.isAvailable !== false,
        preparationTime: Number(b.preparationTime) || 15,
        sizes: Array.isArray(b.sizes) ? b.sizes : null,
        addonsEnabled,
        addons: addonsEnabled && Array.isArray(b.addons) ? b.addons : [],
        inventoryLinks: Array.isArray(b.inventoryLinks) && b.inventoryLinks.length > 0 ? b.inventoryLinks : null,
      } as any);
      res.json(menuItem);
    } catch (error) {
      console.error("Create menu item error:", error);
      res.status(500).json({ error: "Failed to create menu item" });
    }
  });

  app.put("/api/menu/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const b = req.body;
      const updatePayload: any = {};
      if (b.name !== undefined)            updatePayload.name = String(b.name).trim();
      if (b.description !== undefined)     updatePayload.description = b.description ? String(b.description).trim() : null;
      if (b.price !== undefined)           updatePayload.price = String(b.price);
      if (b.categoryId !== undefined)      updatePayload.categoryId = Number(b.categoryId);
      if (b.isAvailable !== undefined)     updatePayload.isAvailable = b.isAvailable !== false;
      if (b.preparationTime !== undefined) updatePayload.preparationTime = Number(b.preparationTime) || 15;
      updatePayload.sizes = Array.isArray(b.sizes) ? b.sizes : null;
      updatePayload.addonsEnabled = b.addonsEnabled === true;
      updatePayload.addons = b.addonsEnabled === true && Array.isArray(b.addons) ? b.addons : [];
      if (b.inventoryLinks !== undefined) updatePayload.inventoryLinks = Array.isArray(b.inventoryLinks) ? b.inventoryLinks : null;
      const menuItem = await storage.updateMenuItem(id, updatePayload);
      res.json(menuItem);
    } catch (error) {
      console.error("Update menu item error:", error);
      res.status(500).json({ error: "Failed to update menu item" });
    }
  });

  app.delete("/api/menu/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMenuItem(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete menu item" });
    }
  });

  // Bulk update menu items
  app.post("/api/menu/bulk-update", requireAuth, async (req, res) => {
    try {
      const { ids, updates } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });
      const allowed: any = {};
      if (updates.isAvailable !== undefined) allowed.isAvailable = Boolean(updates.isAvailable);
      if (updates.categoryId !== undefined) allowed.categoryId = Number(updates.categoryId);
      if (updates.price !== undefined) allowed.price = String(updates.price);
      await storage.bulkUpdateMenuItems(ids.map(Number), allowed);
      queryClient_invalidate: await Promise.resolve();
      res.json({ success: true, updated: ids.length });
    } catch (error) {
      console.error("Bulk update error:", error);
      res.status(500).json({ error: "Failed to bulk update menu items" });
    }
  });

  // Bulk delete menu items
  app.post("/api/menu/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids required" });
      await storage.bulkDeleteMenuItems(ids.map(Number));
      res.json({ success: true, deleted: ids.length });
    } catch (error) {
      console.error("Bulk delete error:", error);
      res.status(500).json({ error: "Failed to bulk delete menu items" });
    }
  });

  // ── Inventory ─────────────────────────────────────────────────────────────────

  app.get("/api/inventory", requireAuth, async (req, res) => {
    try {
      const inventory = await storage.getInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  app.get("/api/inventory/low-stock", requireAuth, async (req, res) => {
    try {
      const lowStockItems = await storage.getLowStockItems();
      res.json(lowStockItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch low stock items" });
    }
  });

  app.post("/api/inventory", requireAuth, async (req, res) => {
    try {
      const inventoryData = insertInventorySchema.parse(req.body);
      const inventory = await storage.createInventoryItem(inventoryData);
      res.json(inventory);
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.put("/api/inventory/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const inventory = await storage.updateInventoryItem(id, req.body);
      res.json(inventory);
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.delete("/api/inventory/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInventoryItem(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete inventory item" });
    }
  });

  // ── Orders ────────────────────────────────────────────────────────────────────

  app.get("/api/orders", requireAuth, async (req, res) => {
    try {
      const { status, startDate, endDate } = req.query;
      let orders;
      if (status) {
        orders = await storage.getOrdersByStatus(status as string);
      } else if (startDate && endDate) {
        orders = await storage.getOrdersByDateRange(
          new Date(startDate as string),
          new Date(endDate as string)
        );
      } else {
        orders = await storage.getOrders();
      }
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Get held orders (must come before /:id route)
  app.get("/api/orders/hold", requireAuth, async (req, res) => {
    try {
      const orders = await storage.getOrdersByStatus("hold");
      const withItems = await Promise.all(
        orders.map(async (o) => {
          const items = await storage.getOrderItems(o.id);
          return { ...o, items };
        })
      );
      res.json(withItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch held orders" });
    }
  });

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const rawItems = await storage.getOrderItems(id);
      // Build name map from all referenced menu items in one batch
      const menuItemIds = Array.from(new Set(rawItems.map((i: any) => i.menuItemId)));
      const menuNameMap: Record<number, string> = {};
      await Promise.all(
        menuItemIds.map(async (mid: any) => {
          const m = await storage.getMenuItemById(mid);
          if (m) menuNameMap[m.id] = m.name;
        })
      );
      const items = rawItems.map((item: any) => ({
        ...item,
        name: menuNameMap[item.menuItemId] || "Deleted Item",
      }));
      res.json({ ...order, items });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", requireAuth, async (req, res) => {
    try {
      const { items, ...orderInfo } = req.body;
      const orderNumber = `ORD${Date.now()}`;
      const order = await storage.createOrder({ ...orderInfo, orderNumber, createdBy: (req.user as any)?.id ?? null });

      // Create order items
      if (items && items.length > 0) {
        for (const item of items) {
          const orderItemData = insertOrderItemSchema.parse({
            ...item,
            orderId: order.id,
          });
          await storage.createOrderItem(orderItemData);
          console.log(`[order] saved orderItem menuItemId=${orderItemData.menuItemId} qty=${orderItemData.quantity}`);
        }
      }

      // Create KOT ticket
      const kotNumber = `KOT${Date.now()}`;
      const kotItems = (items || []).map((item: any) => {
        const addonLines = Array.isArray(item.addons) && item.addons.length > 0
          ? item.addons.map((a: any) => `+ ${a.name}`).join(", ")
          : "";
        return {
          name: item.name,
          quantity: item.quantity,
          instructions: [item.specialInstructions, addonLines].filter(Boolean).join(" | ") || undefined,
        };
      });

      await storage.createKotTicket({ orderId: order.id, kotNumber, items: kotItems });

      // Deduct inventory based on inventoryLinks for each menu item
      if (items && items.length > 0) {
        try {
          await storage.deductInventoryForOrder(
            items.map((i: any) => ({ menuItemId: Number(i.menuItemId), quantity: Number(i.quantity) }))
          );
        } catch (invErr) {
          console.error("[order] inventory deduction error (non-fatal):", invErr);
        }
      }

      // Update table status if dine-in
      if (orderInfo.tableId) {
        await storage.updateTableStatus(Number(orderInfo.tableId), "running", order.id);
        broadcast({ type: 'TABLE_UPDATE' });
      }
      broadcast({ type: 'NEW_ORDER', order, items });

      // ── CRM: log ORDER_PLACED event + update segmentation (fire-and-forget) ──
      const crmKey = (order.customerPhone?.trim() || order.customerName?.trim());
      if (crmKey) {
        const crmName = order.customerName ?? crmKey;
        logOrderPlaced(
          crmKey, crmName, order.customerPhone,
          order.id, order.orderNumber, parseFloat(String(order.totalAmount))
        ).catch(e => console.warn("[CRM] logOrderPlaced failed:", e));

        runSegmentationForCustomer(crmKey, crmName, order.customerPhone)
          .catch(e => console.warn("[CRM] segmentation failed:", e));
      }

      res.json(order);
    } catch (error) {
      console.error("Create order error:", error);
      res.status(400).json({ error: "Invalid order data" });
    }
  });

  app.put("/api/orders/:id/items", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { items, discountAmount, customerName, customerPhone } = req.body;

      // Snapshot existing items BEFORE replacing (for delta KOT)
      const existingItems = await storage.getOrderItems(id);
      const existingMenuItemIds = new Set(existingItems.map((i) => i.menuItemId));

      // Replace all order items
      await storage.deleteOrderItemsByOrderId(id);
      for (const item of items) {
        await storage.createOrderItem({
          orderId: id,
          menuItemId: Number(item.menuItemId),
          quantity: Number(item.quantity),
          price: String(item.price),
          specialInstructions: item.specialInstructions || "",
          size: item.size || null,
        });
      }

      // Recalculate totals
      const settings = getSettings();
      const taxRate = ((settings as any)?.taxRate ?? 18) / 100;
      const subtotal = items.reduce((s: number, i: any) => s + parseFloat(i.price) * Number(i.quantity), 0);
      const discount = parseFloat(discountAmount || "0");
      const taxable = subtotal - discount;
      const tax = taxable * taxRate;
      const total = taxable + tax;

      const order = await storage.updateOrder(id, {
        totalAmount: total.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: discount.toFixed(2),
        ...(customerName !== undefined ? { customerName: customerName || null } : {}),
        ...(customerPhone !== undefined ? { customerPhone: customerPhone || null } : {}),
      } as any);

      // Delta KOT — only print items newly added to this order
      const newItems = items.filter((i: any) => !existingMenuItemIds.has(Number(i.menuItemId)));
      if (newItems.length > 0) {
        const kotNumber = `KOT${Date.now()}`;
        const kotItems = newItems.map((item: any) => ({
          name: item.name,
          quantity: Number(item.quantity),
          instructions: item.specialInstructions || undefined,
        }));
        await storage.createKotTicket({ orderId: id, kotNumber, items: kotItems });
        broadcast({ type: "KOT_UPDATE", action: "created" });
      }

      broadcast({ type: "ORDER_UPDATE", order });
      res.json(order);
    } catch (error) {
      console.error("Update order items error:", error);
      res.status(500).json({ error: "Failed to update order items" });
    }
  });

  app.put("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const orderData = insertOrderSchema.partial().parse(req.body);
      const order = await storage.updateOrder(id, orderData);
      broadcast({ type: 'ORDER_UPDATE', order });
      res.json(order);
    } catch (error) {
      res.status(400).json({ error: "Invalid order data" });
    }
  });

  // Process payment for an order
  app.post("/api/orders/:id/payment", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { paymentMethod, notes } = req.body;
      const isDue = paymentMethod === "due";

      const updateData: any = {
        paymentMethod: paymentMethod || "cash",
        paymentStatus: isDue ? "pending" : "paid",
        status: "served",
      };
      if (notes) updateData.notes = notes;

      const order = await storage.updateOrder(id, updateData);

      // Free the table regardless (customer has left); due orders remain tracked via paymentStatus
      if ((order as any).tableId) {
        await storage.updateTableStatus(Number((order as any).tableId), "free", null);
        broadcast({ type: 'TABLE_UPDATE' });
      }
      broadcast({ type: 'ORDER_UPDATE', order });

      // ── Post-payment hooks (loyalty earn + feedback queue) ──────────────────
      if (!isDue) {
        const key = (order as any).customerPhone?.trim() || (order as any).customerName?.trim();
        if (key) {
          earnPointsForOrder(
            key,
            (order as any).customerName ?? key,
            id,
            parseFloat(String((order as any).totalAmount ?? 0)),
          ).catch(e => console.warn("[Loyalty] earn failed:", e));
        }
        scheduleFeedbackForOrder(id).catch(e => console.warn("[Feedback] schedule failed:", e));
      }

      res.json(order);
    } catch (error) {
      console.error("Payment error:", error);
      res.status(500).json({ error: "Failed to process payment" });
    }
  });

  // ── Due orders (paymentStatus = pending, status = served) ────────────────────
  app.get("/api/orders/due", requireAuth, async (req, res) => {
    try {
      const allOrders = await storage.getOrders();
      const dueOrders = allOrders.filter(
        (o: any) => o.paymentStatus === "pending" && o.status === "served"
      );
      res.json(dueOrders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch due orders" });
    }
  });

  // ── Payment method breakdown for a date range ────────────────────────────────
  app.get("/api/reports/payment-summary", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      let allOrders: any[];
      if (startDate && endDate) {
        allOrders = await storage.getOrdersByDateRange(
          new Date(startDate as string),
          new Date(endDate as string)
        );
      } else {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        allOrders = await storage.getOrdersByDateRange(today, tomorrow);
      }

      // Only count paid orders for revenue; due orders counted separately
      const paid = allOrders.filter((o: any) => o.paymentStatus === "paid");
      const due  = allOrders.filter((o: any) => o.paymentStatus === "pending" && o.status === "served");

      const breakdown: Record<string, { count: number; amount: number }> = {};
      for (const o of paid) {
        const method = o.paymentMethod || "cash";
        if (!breakdown[method]) breakdown[method] = { count: 0, amount: 0 };
        breakdown[method].count++;
        breakdown[method].amount += parseFloat(o.totalAmount || "0");
      }

      const dueTotal = due.reduce((s: number, o: any) => s + parseFloat(o.totalAmount || "0"), 0);

      res.json({
        breakdown,                        // { cash: {count, amount}, upi: {...}, ... }
        totalPaid: paid.reduce((s: number, o: any) => s + parseFloat(o.totalAmount || "0"), 0),
        totalDue: dueTotal,
        dueCount: due.length,
        dueOrders: due,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate payment summary" });
    }
  });

  // ── Table Action: Hold Order ──────────────────────────────────────────────────
  app.put("/api/orders/:id/hold", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      // Free the table
      if ((order as any).tableId) {
        await storage.updateTableStatus(Number((order as any).tableId), "free", null);
      }
      // Mark order as held and clear table association
      await storage.updateOrder(id, { status: "hold", tableId: null, tableNumber: null } as any);
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to hold order" });
    }
  });

  // ── Table Action: Cancel Order ────────────────────────────────────────────────
  app.put("/api/orders/:id/cancel", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      await storage.updateOrder(id, { status: "cancelled" } as any);
      if ((order as any).tableId) {
        await storage.updateTableStatus(Number((order as any).tableId), "free", null);
      }
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // ── Table Action: Move Table ──────────────────────────────────────────────────
  app.put("/api/orders/:id/move-table", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { newTableId, newTableName } = req.body;
      if (!newTableId) return res.status(400).json({ error: "newTableId required" });
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      // Free old table
      if ((order as any).tableId) {
        await storage.updateTableStatus(Number((order as any).tableId), "free", null);
      }
      // Update order with new table
      await storage.updateOrder(id, { tableId: newTableId, tableNumber: newTableName || String(newTableId) } as any);
      // Set new table to running
      await storage.updateTableStatus(newTableId, "running", id);
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to move table" });
    }
  });

  // ── Table Action: Merge Tables ────────────────────────────────────────────────
  // Merges sourceOrderId items INTO targetOrderId, frees source table
  app.post("/api/orders/merge", requireAuth, async (req, res) => {
    try {
      const { targetOrderId, sourceOrderId } = req.body;
      if (!targetOrderId || !sourceOrderId) return res.status(400).json({ error: "targetOrderId and sourceOrderId required" });
      const targetOrder = await storage.getOrderById(targetOrderId);
      const sourceOrder = await storage.getOrderById(sourceOrderId);
      if (!targetOrder || !sourceOrder) return res.status(404).json({ error: "Order not found" });
      // Copy source items into target order
      const sourceItems = await storage.getOrderItems(sourceOrderId);
      for (const item of sourceItems) {
        await storage.createOrderItem({
          orderId: targetOrderId,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions,
          size: item.size,
        } as any);
      }
      // Recalculate target order totals (18% tax fallback)
      const allItems = await storage.getOrderItems(targetOrderId);
      const subtotal = allItems.reduce((s, i) => s + parseFloat(i.price as any) * i.quantity, 0);
      const discount = parseFloat((targetOrder as any).discountAmount || "0");
      const taxable = subtotal - discount;
      const tax = taxable * 0.18;
      await storage.updateOrder(targetOrderId, {
        totalAmount: (taxable + tax).toFixed(2),
        taxAmount: tax.toFixed(2),
      } as any);
      // Free source table and delete source order
      if ((sourceOrder as any).tableId) {
        await storage.updateTableStatus(Number((sourceOrder as any).tableId), "free", null);
      }
      await storage.deleteOrderItemsByOrderId(sourceOrderId);
      await storage.deleteOrder(sourceOrderId);
      broadcast({ type: "TABLE_UPDATE" });
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true });
    } catch (error) {
      console.error("Merge error:", error);
      res.status(500).json({ error: "Failed to merge orders" });
    }
  });

  // ── Table Action: Split Bill ──────────────────────────────────────────────────
  // Splits selected item IDs from an order into a new standalone order
  app.post("/api/orders/:id/split", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { itemIds } = req.body; // array of orderItem IDs to split out
      if (!itemIds || itemIds.length === 0) return res.status(400).json({ error: "itemIds required" });
      const sourceOrder = await storage.getOrderById(id);
      if (!sourceOrder) return res.status(404).json({ error: "Order not found" });
      const allItems = await storage.getOrderItems(id);
      const splitItems = allItems.filter((i) => itemIds.includes(i.id));
      if (splitItems.length === 0) return res.status(400).json({ error: "No matching items" });
      // Calculate new order total
      const subtotal = splitItems.reduce((s, i) => s + parseFloat(i.price as any) * i.quantity, 0);
      const tax = subtotal * 0.18;
      const total = subtotal + tax;
      // Create new split order (takeaway, no table)
      const newOrder = await storage.createOrder({
        orderNumber: `ORD${Date.now()}`,
        orderType: "dine-in",
        status: "pending",
        totalAmount: total.toFixed(2),
        taxAmount: tax.toFixed(2),
        discountAmount: "0",
        paymentStatus: "pending",
        customerName: (sourceOrder as any).customerName || null,
        customerPhone: (sourceOrder as any).customerPhone || null,
        notes: `Split from ${(sourceOrder as any).orderNumber}`,
      } as any);
      // Move split items to new order, delete from source
      for (const item of splitItems) {
        await storage.createOrderItem({
          orderId: newOrder.id,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions,
          size: item.size,
        } as any);
        await storage.deleteOrderItem(item.id);
      }
      // Recalculate source order total
      const remaining = await storage.getOrderItems(id);
      const srcSubtotal = remaining.reduce((s, i) => s + parseFloat(i.price as any) * i.quantity, 0);
      const srcDiscount = parseFloat((sourceOrder as any).discountAmount || "0");
      const srcTaxable = srcSubtotal - srcDiscount;
      const srcTax = srcTaxable * 0.18;
      await storage.updateOrder(id, {
        totalAmount: (srcTaxable + srcTax).toFixed(2),
        taxAmount: srcTax.toFixed(2),
      } as any);
      broadcast({ type: "ORDER_UPDATE" });
      res.json({ success: true, newOrderId: newOrder.id });
    } catch (error) {
      console.error("Split error:", error);
      res.status(500).json({ error: "Failed to split order" });
    }
  });

  // ── KOT Tickets ───────────────────────────────────────────────────────────────

  app.get("/api/kot", requireAuth, async (req, res) => {
    try {
      const { status } = req.query;
      const tickets = status
        ? await storage.getKotTicketsByStatus(status as string)
        : await storage.getKotTickets();
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch KOT tickets" });
    }
  });

  app.put("/api/kot/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const updateData: any = { status };
      if (status === 'completed') updateData.completedAt = new Date();
      const ticket = await storage.updateKotTicket(id, updateData);

      // When KOT is completed, update the associated order to "ready"
      if (status === 'completed' && ticket.orderId) {
        await storage.updateOrder(ticket.orderId, { status: "ready" } as any);
      }
      // When KOT starts (in-progress), update order to "preparing"
      if (status === 'in-progress' && ticket.orderId) {
        await storage.updateOrder(ticket.orderId, { status: "preparing" } as any);
      }

      broadcast({ type: 'KOT_UPDATE', ticket });
      res.json(ticket);
    } catch (error) {
      res.status(400).json({ error: "Invalid KOT data" });
    }
  });

  // ── KOT Running Count ─────────────────────────────────────────────────────────

  app.get("/api/kot/running", requireAuth, async (req, res) => {
    try {
      const pending = await storage.getKotTicketsByStatus("pending");
      const inProgress = await storage.getKotTicketsByStatus("in-progress");
      res.json({ count: pending.length + inProgress.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch KOT count" });
    }
  });

  // ── Delivery Platform Integration ─────────────────────────────────────────────

  app.post("/api/delivery/webhook/:platform", async (req, res) => {
    try {
      const platform = req.params.platform;
      const webhookData = req.body;
      console.log(`Received webhook from ${platform}:`, webhookData);

      if (webhookData.event === 'order_created') {
        const orderData = {
          orderNumber: webhookData.order_id,
          customerName: webhookData.customer_name,
          customerPhone: webhookData.customer_phone,
          orderType: 'delivery',
          source: platform,
          sourceOrderId: webhookData.order_id,
          totalAmount: webhookData.total_amount,
          taxAmount: webhookData.tax_amount,
          status: 'pending',
          paymentStatus: 'paid',
          paymentMethod: 'online',
        };
        const order = await storage.createOrder(orderData);
        broadcast({ type: 'NEW_DELIVERY_ORDER', order, platform });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // ── Reports ───────────────────────────────────────────────────────────────────

  app.get("/api/reports/weekly", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      let end: Date, start: Date;
      if (startDate && endDate) {
        start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
      } else {
        end = new Date();
        end.setHours(23, 59, 59, 999);
        start = new Date();
        start.setDate(start.getDate() - 6);
        start.setHours(0, 0, 0, 0);
      }

      const allOrders = await storage.getOrdersByDateRange(start, end);

      // Build one entry per day in the selected range
      const days: { name: string; date: string; sales: number; orders: number }[] = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        days.push({
          name: cursor.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
          date: cursor.toISOString().slice(0, 10),
          sales: 0,
          orders: 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }

      for (const order of allOrders) {
        const orderDate = new Date(order.createdAt!).toISOString().slice(0, 10);
        const day = days.find(d => d.date === orderDate);
        if (day) {
          day.sales  += parseFloat(order.totalAmount);
          day.orders += 1;
        }
      }

      res.json(days);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate weekly report" });
    }
  });

  app.get("/api/reports/top-items", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : undefined;
      const end   = endDate   ? new Date(endDate   as string) : undefined;
      const topItems = await storage.getTopSellingItems(10, start, end);
      res.json(topItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to get top items" });
    }
  });

  app.get("/api/reports/sales", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      let orders;
      if (startDate && endDate) {
        orders = await storage.getOrdersByDateRange(
          new Date(startDate as string),
          new Date(endDate as string)
        );
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        orders = await storage.getOrdersByDateRange(today, tomorrow);
      }

      const totalSales = orders.reduce((sum, order) => sum + parseFloat(order.totalAmount), 0);
      res.json({
        totalOrders: orders.length,
        totalSales,
        avgOrderValue: orders.length > 0 ? totalSales / orders.length : 0,
        orders,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate sales report" });
    }
  });

  // ── Automation API ────────────────────────────────────────────────────────────

  /** GET /api/automation/config — get current automation config */
  app.get("/api/automation/config", requireAuth, (_req, res) => {
    const config = getAutomationConfig();
    // Never expose API keys in full — mask them
    res.json({
      ...config,
      anthropicApiKey:        config.anthropicApiKey        ? "***configured***" : "",
      watiApiKey:             config.watiApiKey             ? "***configured***" : "",
      metaAccessToken:        config.metaAccessToken        ? "***configured***" : "",
      razorpayKeySecret:      config.razorpayKeySecret      ? "***configured***" : "",
      razorpayWebhookSecret:  config.razorpayWebhookSecret  ? "***configured***" : "",
    });
  });

  /** POST /api/automation/config — update automation config */
  app.post("/api/automation/config", requireAuth, (req, res) => {
    try {
      const patch = req.body as Record<string, unknown>;
      // Don't overwrite keys with masked placeholder
      if (patch.anthropicApiKey       === "***configured***") delete patch.anthropicApiKey;
      if (patch.watiApiKey            === "***configured***") delete patch.watiApiKey;
      if (patch.metaAccessToken       === "***configured***") delete patch.metaAccessToken;
      if (patch.razorpayKeySecret     === "***configured***") delete patch.razorpayKeySecret;
      if (patch.razorpayWebhookSecret === "***configured***") delete patch.razorpayWebhookSecret;

      const updated = saveAutomationConfig(patch);
      restartScheduler();   // pick up new interval setting immediately
      res.json({ ok: true, enabled: updated.enabled });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to save config" });
    }
  });

  /** GET /api/automation/logs — get automation logs, newest first */
  app.get("/api/automation/logs", requireAuth, (req, res) => {
    const limit  = parseInt(String(req.query.limit  ?? "200"), 10);
    const offset = parseInt(String(req.query.offset ?? "0"),   10);
    const logs   = loadLogs().slice().reverse(); // newest first
    res.json({
      total: logs.length,
      logs:  logs.slice(offset, offset + limit),
    });
  });

  /** DELETE /api/automation/logs — clear all logs */
  app.delete("/api/automation/logs", requireAuth, (_req, res) => {
    clearLogs();
    res.json({ ok: true });
  });

  /** GET /api/automation/stats — campaign performance summary */
  app.get("/api/automation/stats", requireAuth, (_req, res) => {
    res.json(getAutomationStats());
  });

  /** POST /api/automation/run — manually trigger one run now (force-bypasses enabled flag) */
  app.post("/api/automation/run", requireAuth, async (_req, res) => {
    try {
      const result = await runCustomerAutomation({ force: true });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Automation run failed" });
    }
  });

  /** POST /api/automation/prefs/:customerId — update customer opt-out pref */
  app.post("/api/automation/prefs/:customerId", requireAuth, (req, res) => {
    const { customerId } = req.params;
    const { doNotSend, mutedUntil } = req.body as { doNotSend?: boolean; mutedUntil?: string };
    setCustomerPref(decodeURIComponent(customerId), { doNotSend, mutedUntil });
    res.json({ ok: true });
  });

  /** GET /api/automation/prefs — all customer preferences */
  app.get("/api/automation/prefs", requireAuth, (_req, res) => {
    res.json(loadCustomerPrefs());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CRM API ROUTES (Phase 9 — additive, all behind requireAuth)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Customer master lookup ─────────────────────────────────────────────────

  /**
   * GET /api/crm/customers/:key
   * Returns the master record + DB profile + current segment for a customer.
   * Falls back gracefully if the customer hasn't been synced to DB yet.
   */
  app.get("/api/crm/customers/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json({ exists: false });

      const profile = await getCustomerProfile(key);
      const segment = await getCustomerSegment(master.id);

      res.json({
        exists:  true,
        id:      master.id,
        key:     master.key,
        name:    master.name,
        phone:   master.phone,
        profile: profile ? dbProfileToExtra(profile) : null,
        segment: segment ? {
          segment:        segment.segment,
          rfmScore:       segment.rfmScore,
          recencyScore:   segment.recencyScore,
          frequencyScore: segment.frequencyScore,
          monetaryScore:  segment.monetaryScore,
          updatedAt:      segment.updatedAt,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Customer events / timeline ─────────────────────────────────────────────

  /**
   * GET /api/crm/customers/:key/events
   * Returns the CRM event timeline for a customer (newest first).
   */
  app.get("/api/crm/customers/:key/events", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json([]);

      const limit  = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
      const events = await getCustomerEvents(master.id, limit);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Profile upsert (sync from client localStorage → DB) ───────────────────

  /**
   * POST /api/crm/customers/:key/profile
   * Saves or updates the extended CRM profile for a customer.
   * Called from the EditCustomerModal Save handler to keep DB in sync.
   */
  app.post("/api/crm/customers/:key/profile", requireAuth, async (req, res) => {
    try {
      const key   = decodeURIComponent(req.params.key);
      const extra = req.body as { name?: string; phone?: string; [key: string]: unknown };

      const name  = extra.name  ?? key;
      const phone = typeof extra.phone === "string" ? extra.phone : undefined;

      const customerId = await resolveCustomerId(key, name, phone);
      const profile    = await upsertCustomerProfile(customerId, extra as any);

      res.json({ ok: true, id: customerId, profile: dbProfileToExtra(profile) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/sync-extras
   * Bulk-syncs the entire localStorage extras map to the DB.
   * Body: { extras: Record<string, CustomerExtra & { name?, phone? }> }
   */
  app.post("/api/crm/sync-extras", requireAuth, async (req, res) => {
    try {
      const { extras } = req.body as { extras: Record<string, any> };
      if (!extras || typeof extras !== "object") {
        return res.status(400).json({ error: "extras map required" });
      }
      const result = await syncLocalStorageExtras(extras);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Recommendations ────────────────────────────────────────────────────────

  /**
   * GET /api/crm/recommendations/:key
   * Returns personalised item recommendations for a customer.
   */
  app.get("/api/crm/recommendations/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const result = await getRecommendations(key);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Message history ────────────────────────────────────────────────────────

  /**
   * GET /api/crm/customers/:key/messages
   * Returns the full message history for a customer.
   */
  app.get("/api/crm/customers/:key/messages", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      if (!master) return res.json([]);

      const messages = await getCustomerMessages(master.id);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/customers/:key/message
   * Send a manual message to a customer via any channel.
   */
  app.post("/api/crm/customers/:key/message", requireAuth, async (req, res) => {
    try {
      const key     = decodeURIComponent(req.params.key);
      const { channel, to, message, subject, trigger } = req.body as {
        channel: "whatsapp" | "email" | "sms";
        to:      string;
        message: string;
        subject?: string;
        trigger?: string;
      };

      if (!channel || !to || !message) {
        return res.status(400).json({ error: "channel, to, and message are required" });
      }

      const master = await getCustomerMaster(key);
      const name   = master?.name ?? key;

      const config = getAutomationConfig();
      const result = await sendMessage(key, name, { channel, to, message, subject, trigger }, {
        watiApiKey:   config.watiApiKey,
        watiEndpoint: config.watiEndpoint,
      });

      res.json({ ok: result.success, mode: result.mode, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Segmentation ───────────────────────────────────────────────────────────

  /**
   * POST /api/crm/segment/:key
   * Recomputes the RFM segment for a single customer.
   */
  app.post("/api/crm/segment/:key", requireAuth, async (req, res) => {
    try {
      const key    = decodeURIComponent(req.params.key);
      const master = await getCustomerMaster(key);
      const result = await runSegmentationForCustomer(
        key,
        master?.name ?? key,
        master?.phone
      );
      res.json({ ok: !!result, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/segment/batch
   * Runs full batch segmentation for all customers.
   */
  app.post("/api/crm/segment/batch", requireAdmin, async (_req, res) => {
    try {
      const result = await runSegmentationForAll();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ── Server-side automation ─────────────────────────────────────────────────

  /**
   * POST /api/crm/automation/run
   * Runs the server-side rule engine (separate from the client-side engine).
   */
  app.post("/api/crm/automation/run", requireAuth, async (req, res) => {
    try {
      const { force, limit } = req.body as { force?: boolean; limit?: number };
      const result = await runAutomationServerSide({ force: force ?? true, limit });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * GET /api/crm/automation/rules
   * Returns all automation rules from DB.
   */
  app.get("/api/crm/automation/rules", requireAuth, async (_req, res) => {
    try {
      const rules = await db.select().from(automationRules).orderBy(automationRules.createdAt);
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * POST /api/crm/automation/rules
   * Creates a new automation rule.
   */
  app.post("/api/crm/automation/rules", requireAdmin, async (req, res) => {
    try {
      const { name, triggerType, conditions, actions, isActive } = req.body;
      const [rule] = await db
        .insert(automationRules)
        .values({ name, triggerType, conditions, actions, isActive: isActive ?? true })
        .returning();
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * PATCH /api/crm/automation/rules/:id
   * Updates an existing automation rule.
   */
  app.patch("/api/crm/automation/rules/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { name, triggerType, conditions, actions, isActive } = req.body;
      const [rule] = await db
        .update(automationRules)
        .set({ name, triggerType, conditions, actions, isActive })
        .where(eq(automationRules.id, id))
        .returning();
      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  /**
   * GET /api/crm/automation/jobs
   * Returns recent automation jobs (newest first).
   */
  app.get("/api/crm/automation/jobs", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
      const jobs  = await db
        .select()
        .from(automationJobs)
        .orderBy(desc(automationJobs.scheduledAt))
        .limit(limit);
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  return httpServer;
}
