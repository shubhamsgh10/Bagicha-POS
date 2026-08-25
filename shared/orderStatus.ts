// pending/preparing/ready = still on the floor. "hold" is a parked order (table
// freed, nothing owed — see CLAUDE.md's Hold/Recall note) and NOT active.
// served/delivered/cancelled are terminal.
export const ACTIVE_ORDER_STATUSES = ["pending", "preparing", "ready"] as const;
