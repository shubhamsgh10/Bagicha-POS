import { db } from "./db";
import { categories, menuItems, inventory } from "@shared/schema";

async function seedDatabase() {
  console.log("Seeding database...");

  // Clear existing data
  await db.delete(menuItems);
  await db.delete(categories);
  await db.delete(inventory);

  // Add categories
  const categoryData = [
    { name: "Appetizers", description: "Start your meal with our delicious appetizers" },
    { name: "Main Course", description: "Hearty main dishes and curries" },
    { name: "Biryani & Rice", description: "Fragrant rice dishes and biryanis" },
    { name: "Bread", description: "Fresh naan, roti, and other breads" },
    { name: "Desserts", description: "Sweet treats to end your meal" },
    { name: "Beverages", description: "Refreshing drinks and traditional beverages" },
  ];

  const insertedCategories = await db.insert(categories).values(categoryData).returning();
  console.log(`Added ${insertedCategories.length} categories`);

  // Add menu items
  const menuItemsData = [
    // Appetizers
    { name: "Paneer Tikka", description: "Grilled cottage cheese with spices", price: "320", categoryId: insertedCategories[0].id, preparationTime: 15 },
    { name: "Chicken Tikka", description: "Marinated chicken pieces grilled to perfection", price: "380", categoryId: insertedCategories[0].id, preparationTime: 20 },
    { name: "Vegetable Samosa", description: "Crispy pastry filled with spiced vegetables", price: "120", categoryId: insertedCategories[0].id, preparationTime: 10 },
    { name: "Seekh Kebab", description: "Minced meat kebabs with aromatic spices", price: "420", categoryId: insertedCategories[0].id, preparationTime: 18 },

    // Main Course
    { name: "Butter Chicken", description: "Creamy tomato-based chicken curry", price: "480", categoryId: insertedCategories[1].id, preparationTime: 25 },
    { name: "Dal Makhani", description: "Rich and creamy black lentil curry", price: "320", categoryId: insertedCategories[1].id, preparationTime: 20 },
    { name: "Palak Paneer", description: "Cottage cheese in spinach gravy", price: "360", categoryId: insertedCategories[1].id, preparationTime: 20 },
    { name: "Chicken Curry", description: "Traditional chicken curry with Indian spices", price: "420", categoryId: insertedCategories[1].id, preparationTime: 25 },

    // Biryani & Rice
    { name: "Chicken Biryani", description: "Fragrant basmati rice with marinated chicken", price: "520", categoryId: insertedCategories[2].id, preparationTime: 30 },
    { name: "Vegetable Biryani", description: "Aromatic rice with mixed vegetables", price: "380", categoryId: insertedCategories[2].id, preparationTime: 25 },
    { name: "Mutton Biryani", description: "Premium basmati rice with tender mutton", price: "620", categoryId: insertedCategories[2].id, preparationTime: 35 },
    { name: "Jeera Rice", description: "Cumin flavored basmati rice", price: "180", categoryId: insertedCategories[2].id, preparationTime: 15 },

    // Bread
    { name: "Butter Naan", description: "Soft bread with butter", price: "80", categoryId: insertedCategories[3].id, preparationTime: 8 },
    { name: "Garlic Naan", description: "Naan topped with garlic and herbs", price: "90", categoryId: insertedCategories[3].id, preparationTime: 10 },
    { name: "Roti", description: "Traditional whole wheat bread", price: "40", categoryId: insertedCategories[3].id, preparationTime: 5 },
    { name: "Kulcha", description: "Stuffed bread with onions or potato", price: "120", categoryId: insertedCategories[3].id, preparationTime: 12 },

    // Desserts
    { name: "Gulab Jamun", description: "Sweet milk dumplings in sugar syrup", price: "150", categoryId: insertedCategories[4].id, preparationTime: 5 },
    { name: "Rasmalai", description: "Cottage cheese dumplings in milk", price: "180", categoryId: insertedCategories[4].id, preparationTime: 5 },
    { name: "Kulfi", description: "Traditional Indian ice cream", price: "120", categoryId: insertedCategories[4].id, preparationTime: 2 },

    // Beverages
    { name: "Lassi", description: "Yogurt-based drink", price: "80", categoryId: insertedCategories[5].id, preparationTime: 3 },
    { name: "Masala Chai", description: "Spiced tea", price: "50", categoryId: insertedCategories[5].id, preparationTime: 5 },
    { name: "Fresh Lime Soda", description: "Refreshing lime drink", price: "60", categoryId: insertedCategories[5].id, preparationTime: 3 },
  ];

  const insertedMenuItems = await db.insert(menuItems).values(menuItemsData).returning();
  console.log(`Added ${insertedMenuItems.length} menu items`);

  // Add inventory items
  const inventoryData = [
    { itemName: "Chicken", currentStock: "25", minStock: "5", unit: "kg" },
    { itemName: "Paneer", currentStock: "8", minStock: "3", unit: "kg" },
    { itemName: "Basmati Rice", currentStock: "50", minStock: "10", unit: "kg" },
    { itemName: "Onions", currentStock: "20", minStock: "5", unit: "kg" },
    { itemName: "Tomatoes", currentStock: "15", minStock: "5", unit: "kg" },
    { itemName: "Flour", currentStock: "30", minStock: "10", unit: "kg" },
    { itemName: "Cooking Oil", currentStock: "25", minStock: "8", unit: "liters" },
    { itemName: "Spices Mix", currentStock: "5", minStock: "2", unit: "kg" },
    { itemName: "Milk", currentStock: "12", minStock: "5", unit: "liters" },
    { itemName: "Yogurt", currentStock: "8", minStock: "3", unit: "kg" },
  ];

  const insertedInventoryItems = await db.insert(inventory).values(inventoryData).returning();
  console.log(`Added ${insertedInventoryItems.length} inventory items`);

  console.log("Database seeding completed!");
}

// Run seed function if file is executed directly
seedDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error seeding database:", error);
    process.exit(1);
  });

export { seedDatabase };