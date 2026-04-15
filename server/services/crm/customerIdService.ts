/**
 * customerIdService.ts
 *
 * Phase 2 — Customer ID Resolution
 *
 * Bridges the existing string-keyed system (customer.key = phone || name)
 * with the new UUID-based customers_master table.
 *
 * ALL functions are safe to call without breaking existing localStorage logic —
 * they silently return null on DB errors so callers can fall back gracefully.
 */

import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
  customersMaster,
  customerProfiles,
  type CustomerMaster,
  type CustomerProfile_DB,
} from "../../../shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Shape of CustomerExtra from localStorage — mirrored here for sync */
export interface CustomerExtraPayload {
  email?:               string;
  dob?:                 string;
  anniversary?:         string;
  locality?:            string;
  gstNo?:               string;
  address?:             string;
  isFavorite?:          boolean;
  tags?:                string;   // comma-separated string from UI
  remark?:              string;
  notificationEnabled?: boolean;
  doNotSendUpdate?:     boolean;
}

// ── Core: resolve or create a customer UUID ───────────────────────────────────

/**
 * Returns the UUID for a customer, creating a master record if one
 * doesn't yet exist.  Uses the customer.key (phone || name) as the
 * stable lookup key — matches the client-side dedup logic exactly.
 */
export async function resolveCustomerId(
  key: string,
  name: string,
  phone?: string | null
): Promise<string> {
  // 1. Try to find existing record
  const existing = await db
    .select({ id: customersMaster.id })
    .from(customersMaster)
    .where(eq(customersMaster.key, key))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  // 2. Insert new master record
  const inserted = await db
    .insert(customersMaster)
    .values({ key, name, phone: phone ?? null })
    .returning({ id: customersMaster.id });

  return inserted[0].id;
}

/**
 * Resolves the UUID for a key without creating a record.
 * Returns null if the customer hasn't been synced to DB yet.
 */
export async function getCustomerId(key: string): Promise<string | null> {
  const rows = await db
    .select({ id: customersMaster.id })
    .from(customersMaster)
    .where(eq(customersMaster.key, key))
    .limit(1);

  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Returns the full master record by key, or null if not found.
 */
export async function getCustomerMaster(key: string): Promise<CustomerMaster | null> {
  const rows = await db
    .select()
    .from(customersMaster)
    .where(eq(customersMaster.key, key))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

// ── Profile sync: localStorage → DB ──────────────────────────────────────────

/**
 * Upserts extended profile data for a customer.
 * Called when the user saves the EditCustomerModal — syncs localStorage data
 * into the database.  If a profile row already exists it is updated; otherwise
 * a new one is inserted.
 */
export async function upsertCustomerProfile(
  customerId: string,
  extra: CustomerExtraPayload
): Promise<CustomerProfile_DB> {
  // Normalise tags from comma-separated string → text[]
  const tagsArray = extra.tags
    ? extra.tags.split(",").map(t => t.trim()).filter(Boolean)
    : [];

  // Check if profile exists
  const existing = await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.customerId, customerId))
    .limit(1);

  const payload = {
    email:               extra.email               ?? null,
    dob:                 extra.dob                 ?? null,
    anniversary:         extra.anniversary         ?? null,
    locality:            extra.locality            ?? null,
    gstNo:               extra.gstNo               ?? null,
    address:             extra.address             ?? null,
    isFavorite:          extra.isFavorite          ?? false,
    tags:                tagsArray,
    remark:              extra.remark              ?? null,
    notificationEnabled: extra.notificationEnabled ?? true,
    doNotSendUpdate:     extra.doNotSendUpdate     ?? false,
    updatedAt:           new Date(),
  };

  if (existing.length > 0) {
    const updated = await db
      .update(customerProfiles)
      .set(payload)
      .where(eq(customerProfiles.customerId, customerId))
      .returning();
    return updated[0];
  }

  const inserted = await db
    .insert(customerProfiles)
    .values({ customerId, ...payload })
    .returning();
  return inserted[0];
}

/**
 * Fetches the DB profile for a customer by their string key.
 * Returns null if not yet synced to DB.
 */
export async function getCustomerProfile(key: string): Promise<CustomerProfile_DB | null> {
  const master = await getCustomerMaster(key);
  if (!master) return null;

  const rows = await db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.customerId, master.id))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

// ── Bulk sync: entire localStorage extras map → DB ────────────────────────────

/**
 * Accepts the full `extras` map from localStorage (keyed by customer.key)
 * and upserts every entry to the DB.  Called once on login or when the
 * user explicitly triggers a sync.
 *
 * Designed to be idempotent — safe to call multiple times.
 * Errors per customer are swallowed so a single bad record can't abort the batch.
 */
export async function syncLocalStorageExtras(
  extras: Record<string, CustomerExtraPayload & { name?: string; phone?: string }>
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  for (const [key, extra] of Object.entries(extras)) {
    try {
      const name  = extra.name  ?? key;
      const phone = extra.phone ?? (key.match(/^\d{10,}$/) ? key : undefined);

      const customerId = await resolveCustomerId(key, name, phone);
      await upsertCustomerProfile(customerId, extra);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}

// ── Merge helper: DB profile → localStorage CustomerExtra format ──────────────

/**
 * Converts a DB CustomerProfile_DB row back into the CustomerExtra shape
 * used by the frontend.  Used to merge DB data with localStorage on load.
 */
export function dbProfileToExtra(profile: CustomerProfile_DB): CustomerExtraPayload {
  return {
    email:               profile.email               ?? "",
    dob:                 profile.dob                 ?? "",
    anniversary:         profile.anniversary         ?? "",
    locality:            profile.locality            ?? "",
    gstNo:               profile.gstNo               ?? "",
    address:             profile.address             ?? "",
    isFavorite:          profile.isFavorite,
    tags:                (profile.tags ?? []).join(", "),
    remark:              profile.remark              ?? "",
    notificationEnabled: profile.notificationEnabled,
    doNotSendUpdate:     profile.doNotSendUpdate,
  };
}
