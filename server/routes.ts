import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { insertOrderSchema, insertOrderItemSchema, insertKotTicketSchema, insertMenuItemSchema, insertCategorySchema, insertInventorySchema } from "@shared/schema";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import crypto from "crypto";

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
  } catch (err) {
    console.error("Failed to ensure admin user:", err);
  }

  // Auth Routes
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

  // Update username
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

  // Change password
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

  // Dashboard Stats
  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Categories
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

  // Menu Items
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
      const menuItemData = insertMenuItemSchema.parse(req.body);
      const menuItem = await storage.createMenuItem(menuItemData);
      res.json(menuItem);
    } catch (error) {
      res.status(400).json({ error: "Invalid menu item data" });
    }
  });

  app.put("/api/menu/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const menuItemData = insertMenuItemSchema.partial().parse(req.body);
      const menuItem = await storage.updateMenuItem(id, menuItemData);
      res.json(menuItem);
    } catch (error) {
      res.status(400).json({ error: "Invalid menu item data" });
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

  // Inventory Management
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
      const { currentStock, ...inventoryData } = req.body;
      const inventory = await storage.updateInventoryItem(id, inventoryData);
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

  // Orders
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
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      const items = await storage.getOrderItems(id);
      res.json({ ...order, items });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  app.post("/api/orders", requireAuth, async (req, res) => {
    try {
      const orderData = insertOrderSchema.parse(req.body);
      const { items, ...orderInfo } = req.body;

      // Generate order number
      const orderNumber = `ORD${Date.now()}`;

      const order = await storage.createOrder({
        ...orderInfo,
        orderNumber,
      });

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
      const kotItems = items.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        instructions: item.specialInstructions
      }));

      await storage.createKotTicket({
        orderId: order.id,
        kotNumber,
        items: kotItems,
      });

      broadcast({
        type: 'NEW_ORDER',
        order: order,
        items: items
      });

      res.json(order);
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: "Invalid order data" });
    }
  });

  app.put("/api/orders/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const orderData = insertOrderSchema.partial().parse(req.body);
      const order = await storage.updateOrder(id, orderData);

      broadcast({
        type: 'ORDER_UPDATE',
        order: order
      });

      res.json(order);
    } catch (error) {
      res.status(400).json({ error: "Invalid order data" });
    }
  });

  // KOT Tickets
  app.get("/api/kot", requireAuth, async (req, res) => {
    try {
      const { status } = req.query;

      let tickets;
      if (status) {
        tickets = await storage.getKotTicketsByStatus(status as string);
      } else {
        tickets = await storage.getKotTickets();
      }

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
      if (status === 'completed') {
        updateData.completedAt = new Date();
      }

      const ticket = await storage.updateKotTicket(id, updateData);

      broadcast({
        type: 'KOT_UPDATE',
        ticket: ticket
      });

      res.json(ticket);
    } catch (error) {
      res.status(400).json({ error: "Invalid KOT data" });
    }
  });

  // Delivery Platform Integration
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

        broadcast({
          type: 'NEW_DELIVERY_ORDER',
          order: order,
          platform: platform
        });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: "Webhook processing failed" });
    }
  });

  // Reports
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

      const totalSales = orders.reduce((sum, order) =>
        sum + parseFloat(order.totalAmount), 0
      );

      const report = {
        totalOrders: orders.length,
        totalSales,
        avgOrderValue: orders.length > 0 ? totalSales / orders.length : 0,
        orders: orders
      };

      res.json(report);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate sales report" });
    }
  });

  return httpServer;
}
