export const ORDER_STATUS = {
  PENDING: 'pending',
  PREPARING: 'preparing',
  READY: 'ready',
  SERVED: 'served',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
} as const;

export const KOT_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed'
} as const;

export const ORDER_TYPES = {
  DINE_IN: 'dine-in',
  TAKEAWAY: 'takeaway',
  DELIVERY: 'delivery'
} as const;

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  UPI: 'upi',
  ONLINE: 'online'
} as const;

export const DELIVERY_PLATFORMS = {
  ZOMATO: 'zomato',
  SWIGGY: 'swiggy',
  UBER_EATS: 'uber-eats'
} as const;
