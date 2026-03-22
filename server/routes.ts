import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { insertOrderItemSchema, insertKotTicketSchema, insertCategorySchema, insertInventorySchema, insertOrderSchema } from "@shared/schema";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import crypto from "crypto";
import { getSettings, saveSettings } from "./settingsStore";

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
function requireAuth(req: any, res: any, next: any) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: "Unauthorized" });
}

// Middleware to require admin role
function requireAdmin(req: any, res: any, next: any) {
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

  // ── User Management (Admin only) ──────────────────────────────────────────────

  app.get("/api/users", requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getUsers();
      const safeUsers = allUsers.map(({ password, ...u }) => u);
      res.json(safeUsers);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) return res.status(400).json({ message: "Username and password are required" });
      if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
      const existing = await storage.getUserByUsername(username.trim());
      if (existing) return res.status(409).json({ message: "Username already taken" });
      const hashed = await hashPassword(password);
      const user = await storage.createUser({
        username: username.trim(),
        password: hashed,
        role: role || "staff",
      });
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (err) {
      console.error("Create user error:", err);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.put("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const currentUser = req.user as any;
      const { role, username, password } = req.body;
      const updateData: any = {};
      if (role) updateData.role = role;
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
      const { password: _, ...safeUser } = updated;
      res.json(safeUser);
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

  // ── Menu Items ────────────────────────────────────────────────────────────────

  app.get("/api/menu", requireAuth, async (req, res) => {
    try {
      const menuItems = await storage.getMenuItems();
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
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

  app.get("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrderById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      const items = await storage.getOrderItems(id);
      res.json({ ...order, items });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", requireAuth, async (req, res) => {
    try {
      const { items, ...orderInfo } = req.body;
      const orderNumber = `ORD${Date.now()}`;
      const order = await storage.createOrder({ ...orderInfo, orderNumber });

      // Create order items
      if (items && items.length > 0) {
        for (const item of items) {
          const orderItemData = insertOrderItemSchema.parse({
            ...item,
            orderId: order.id,
          });
          await storage.createOrderItem(orderItemData);
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

      broadcast({ type: 'NEW_ORDER', order, items });
      res.json(order);
    } catch (error) {
      console.error("Create order error:", error);
      res.status(400).json({ error: "Invalid order data" });
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
      const { paymentMethod } = req.body;
      const order = await storage.updateOrder(id, {
        paymentStatus: "paid",
        paymentMethod: paymentMethod || "cash",
        status: "served",
      } as any);
      broadcast({ type: 'ORDER_UPDATE', order });
      res.json(order);
    } catch (error) {
      console.error("Payment error:", error);
      res.status(500).json({ error: "Failed to process payment" });
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
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);

      const allOrders = await storage.getOrdersByDateRange(start, end);

      const days: { name: string; date: string; sales: number; orders: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push({
          name: d.toLocaleDateString("en-IN", { weekday: "short" }),
          date: d.toISOString().slice(0, 10),
          sales: 0,
          orders: 0,
        });
      }

      for (const order of allOrders) {
        const orderDate = new Date(order.createdAt!).toISOString().slice(0, 10);
        const day = days.find(d => d.date === orderDate);
        if (day) {
          day.sales += parseFloat(order.totalAmount);
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
      const topItems = await storage.getTopSellingItems(10);
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

  return httpServer;
}
