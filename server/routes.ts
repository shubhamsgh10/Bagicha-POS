import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { insertOrderSchema, insertOrderItemSchema, insertKotTicketSchema, insertMenuItemSchema, insertCategorySchema, insertInventorySchema } from "@shared/schema";

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

  // Dashboard Stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Categories
  app.get("/api/categories", async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      res.json(category);
    } catch (error) {
      res.status(400).json({ error: "Invalid category data" });
    }
  });

  // Menu Items
  app.get("/api/menu", async (req, res) => {
    try {
      const menuItems = await storage.getMenuItems();
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.get("/api/menu/category/:categoryId", async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const menuItems = await storage.getMenuItemsByCategory(categoryId);
      res.json(menuItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch menu items" });
    }
  });

  app.post("/api/menu", async (req, res) => {
    try {
      const menuItemData = insertMenuItemSchema.parse(req.body);
      const menuItem = await storage.createMenuItem(menuItemData);
      res.json(menuItem);
    } catch (error) {
      res.status(400).json({ error: "Invalid menu item data" });
    }
  });

  app.put("/api/menu/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const menuItemData = insertMenuItemSchema.partial().parse(req.body);
      const menuItem = await storage.updateMenuItem(id, menuItemData);
      res.json(menuItem);
    } catch (error) {
      res.status(400).json({ error: "Invalid menu item data" });
    }
  });

  app.delete("/api/menu/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteMenuItem(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete menu item" });
    }
  });

  // Inventory Management
  app.get("/api/inventory", async (req, res) => {
    try {
      const inventory = await storage.getInventory();
      res.json(inventory);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  app.get("/api/inventory/low-stock", async (req, res) => {
    try {
      const lowStockItems = await storage.getLowStockItems();
      res.json(lowStockItems);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch low stock items" });
    }
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const inventoryData = insertInventorySchema.parse(req.body);
      const inventory = await storage.createInventoryItem(inventoryData);
      res.json(inventory);
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.put("/api/inventory/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { currentStock, ...inventoryData } = req.body;
      
      if (currentStock !== undefined) {
        const inventory = await storage.updateInventory(id, parseFloat(currentStock));
        res.json(inventory);
      } else {
        const inventory = await storage.updateInventoryItem(id, inventoryData);
        res.json(inventory);
      }
    } catch (error) {
      res.status(400).json({ error: "Invalid inventory data" });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteInventoryItem(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete inventory item" });
    }
  });

  // Continue with existing routes...

  // Orders
  app.get("/api/orders", async (req, res) => {
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

  app.get("/api/orders/:id", async (req, res) => {
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

  app.post("/api/orders", async (req, res) => {
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

  app.put("/api/orders/:id", async (req, res) => {
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
  app.get("/api/kot", async (req, res) => {
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

  app.put("/api/kot/:id", async (req, res) => {
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
      
      // Mock integration for delivery platforms
      console.log(`Received webhook from ${platform}:`, webhookData);
      
      // Process webhook data and create/update orders
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
  app.get("/api/reports/sales", async (req, res) => {
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
