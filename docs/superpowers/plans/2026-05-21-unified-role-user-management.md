# Unified Role & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate scattered role/user management into a clean Admin page (2 tabs), add a proper staff login role with page-access control, and redesign the mobile login page to show staff name cards while leaving the desktop login untouched.

**Architecture:** Backend gains a `staffAllowedPages` setting (mirroring `managerAllowedPages`) with two new endpoints. The Admin page is rewritten into two tabs — Accounts (unified table of all user types) and Role Permissions (manager + staff page toggles). The Login page is split by breakpoint: desktop shows the existing form unchanged, mobile shows staff name cards with PIN entry + a "Manager / Admin Login" toggle.

**Tech Stack:** React + TypeScript, react-hook-form, TanStack Query, shadcn/ui (Tabs, Dialog, Switch), Tailwind CSS, Express, Drizzle ORM (no schema changes needed).

---

## File Map

| File | Action | What changes |
|---|---|---|
| `server/settingsStore.ts` | Modify | Add `staffAllowedPages: string[] \| null` to interface + default |
| `server/routes.ts` | Modify | Add `GET/POST /api/settings/staff-pages` endpoints after manager-pages |
| `client/src/components/TopNav.tsx` | Modify | Add staff page enforcement (mirror manager logic) + expose staff in NAV_ITEMS |
| `client/src/pages/Admin.tsx` | Rewrite | Replace Users+Roles tabs with 2-tab layout: Accounts + Role Permissions |
| `client/src/pages/Settings.tsx` | Modify | Remove Staff Selector panel + Manager Page Access panel |
| `client/src/pages/Login.tsx` | Modify | Make staff card screen mobile-only; add "Manager / Admin Login →" toggle |

---

## Task 1: Add staffAllowedPages to backend

**Files:**
- Modify: `server/settingsStore.ts`
- Modify: `server/routes.ts`

### settingsStore.ts

- [ ] **Step 1: Add field to RestaurantSettings interface**

In `server/settingsStore.ts`, find the interface at line ~57. Add `staffAllowedPages` after `managerAllowedPages`:

```typescript
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
  posRoleTimeout: number;
  printSettings: PrintConfigSettings;
  managerAllowedPages: string[] | null;
  staffAllowedPages: string[] | null;   // ← add this line
}
```

- [ ] **Step 2: Add default value**

In the `defaultSettings` object (line ~116), add the default after `managerAllowedPages: null`:

```typescript
managerAllowedPages: null,
staffAllowedPages: null,   // ← add this line
```

### routes.ts

- [ ] **Step 3: Add staff-pages endpoints**

In `server/routes.ts`, find the manager-pages endpoints at line ~553. Add the staff-pages endpoints immediately after them:

```typescript
// GET: Retrieve current staff page restrictions
app.get("/api/settings/staff-pages", requireAuth, (_req, res) => {
  const s = getSettings();
  res.json({ staffAllowedPages: s.staffAllowedPages });
});

// POST: Update staff page restrictions (admin only)
app.post("/api/settings/staff-pages", requireAdmin, (req, res) => {
  const { staffAllowedPages } = req.body;
  const updated = saveSettings({ staffAllowedPages: staffAllowedPages ?? null });
  res.json({ staffAllowedPages: updated.staffAllowedPages });
});
```

- [ ] **Step 4: Run TypeScript check**

```bash
npm run check
```

Expected: no errors related to settingsStore or routes.

- [ ] **Step 5: Commit**

```bash
git add server/settingsStore.ts server/routes.ts
git commit -m "feat: add staffAllowedPages setting + GET/POST /api/settings/staff-pages"
```

---

## Task 2: Enforce staff page access in TopNav

**Files:**
- Modify: `client/src/components/TopNav.tsx`

- [ ] **Step 1: Add staff to NAV_ITEMS roles**

In `client/src/components/TopNav.tsx`, the NAV_ITEMS array is at line ~23. Several items have `roles: ["admin", "manager"]`. Update them to also include `"staff"` where appropriate — staff should be able to see Tables, Orders, KOT, and Kitchen but NOT Staff management, Menu editing, Inventory, Live Tables, Customers, or admin-only pages:

```typescript
const NAV_ITEMS: NavItem[] = [
  { label: "Tables",      href: "/tables",        icon: LayoutGrid },
  { label: "Orders",      href: "/orders",        icon: History },
  { label: "Billing",     href: "/billing",       icon: CreditCard },
  { label: "KOT",         href: "/kot",           icon: ClipboardList },
  { label: "Staff",       href: "/staff",         icon: UserCheck,       roles: ["admin", "manager"] },
  { label: "Menu",        href: "/menu",          icon: UtensilsCrossed, roles: ["admin", "manager"] },
  { label: "Inventory",   href: "/inventory",     icon: Package,         roles: ["admin", "manager"] },
  { label: "Live Tables", href: "/live-tables",   icon: Monitor,         roles: ["admin", "manager"] },
  { label: "Kitchen",     href: "/kitchen",       icon: ChefHat,         roles: ["admin", "manager"] },
  { label: "Customers",   href: "/customers",     icon: Users,           roles: ["admin", "manager"] },
  { label: "Live View",   href: "/live-analytics",icon: Activity,        roles: ["admin"] },
  { label: "Reports",     href: "/reports",       icon: BarChart3,       roles: ["admin"] },
  { label: "Admin",       href: "/admin",         icon: User,            roles: ["admin"] },
  { label: "Settings",    href: "/settings",      icon: Settings,        roles: ["admin"] },
];
```

(This is unchanged — staff will see pages not restricted by `roles` field. Their further restrictions come from `staffAllowedPages` below.)

- [ ] **Step 2: Fetch staffAllowedPages in the settings query**

The settings query already fetches `/api/settings`. The response now includes `staffAllowedPages`. No query change needed — it comes through automatically.

- [ ] **Step 3: Add staff enforcement in visibleNav filter**

Find the `visibleNav` filter at line ~57. It currently has manager enforcement. Add staff enforcement directly after it:

```typescript
const visibleNav = NAV_ITEMS.filter(item => {
  if (item.roles && !item.roles.includes(activeRole)) return false;
  if (activeRole === "manager" && settings?.managerAllowedPages) {
    if (!settings.managerAllowedPages.includes(item.href)) return false;
  }
  if (activeRole === "staff" && settings?.staffAllowedPages) {
    if (!settings.staffAllowedPages.includes(item.href)) return false;
  }
  return true;
});
```

- [ ] **Step 4: Run TypeScript check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TopNav.tsx
git commit -m "feat: enforce staffAllowedPages in TopNav navigation filter"
```

---

## Task 3: Rewrite Admin page — 2-tab unified layout

**Files:**
- Modify: `client/src/pages/Admin.tsx`

This is the largest task. We rewrite the Users tab and Roles tab into a single "Accounts" tab, and replace the Roles tab with a "Role Permissions" tab that includes both manager and staff page access panels (moved from Settings).

- [ ] **Step 1: Add missing imports to Admin.tsx**

Ensure these are imported at the top of `client/src/pages/Admin.tsx`. Add any that are missing:

```typescript
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, ShieldCheck, User as UserIcon, KeyRound } from "lucide-react";
import type { User } from "@shared/schema";
```

- [ ] **Step 2: Update constants at the top of Admin.tsx**

Replace the existing `ROLES` constant and `roleColors` (lines ~60–68) with:

```typescript
const ROLES = ["admin", "manager", "staff"] as const;
type Role = typeof ROLES[number];

const roleColors: Record<string, string> = {
  admin:   "bg-amber-100 text-amber-800",
  manager: "bg-blue-100 text-blue-800",
  staff:   "bg-green-100 text-green-800",
};

const staffMemberColor = "bg-purple-100 text-purple-800";
```

- [ ] **Step 3: Add managerPages + staffAllowedPages queries and state inside Admin component**

The managerPages query was previously in `Settings.tsx`. Move it to the Admin component, and add the new staffPages query alongside it. Both are needed by the `RolePermissionsTab`. Place these in the main `Admin` component body (not inside sub-components):

```typescript
// Manager pages (moved from Settings.tsx)
const { data: managerPagesData, refetch: refetchManagerPages } = useQuery<{ managerAllowedPages: string[] | null }>({
  queryKey: ["/api/settings/manager-pages"],
});
const [managerPages, setManagerPages] = useState<Record<string, boolean>>({});

useEffect(() => {
  if (managerPagesData) {
    const allowed = managerPagesData.managerAllowedPages;
    const init: Record<string, boolean> = {};
    PAGE_ACCESS_LIST.forEach(p => { init[p.href] = allowed === null || allowed.includes(p.href); });
    setManagerPages(init);
  }
}, [managerPagesData]);

const saveManagerPagesMutation = useMutation({
  mutationFn: async (pages: Record<string, boolean>) => {
    const allowed = Object.entries(pages).filter(([, v]) => v).map(([href]) => href);
    const allOn = allowed.length === PAGE_ACCESS_LIST.length;
    return apiRequest("POST", "/api/settings/manager-pages", { managerAllowedPages: allOn ? null : allowed });
  },
  onSuccess: () => { refetchManagerPages(); toast({ title: "Manager page access saved" }); },
});

// Staff pages (new)
const { data: staffPagesData, refetch: refetchStaffPages } = useQuery<{ staffAllowedPages: string[] | null }>({
  queryKey: ["/api/settings/staff-pages"],
});
const [staffPages, setStaffPages] = useState<Record<string, boolean>>({});

useEffect(() => {
  if (staffPagesData) {
    const allowed = staffPagesData.staffAllowedPages;
    const init: Record<string, boolean> = {};
    PAGE_ACCESS_LIST.forEach(p => { init[p.href] = allowed === null || allowed.includes(p.href); });
    setStaffPages(init);
  }
}, [staffPagesData]);

const saveStaffPagesMutation = useMutation({
  mutationFn: async (pages: Record<string, boolean>) => {
    const allowed = Object.entries(pages).filter(([, v]) => v).map(([href]) => href);
    const allOn = allowed.length === PAGE_ACCESS_LIST.length;
    return apiRequest("POST", "/api/settings/staff-pages", { staffAllowedPages: allOn ? null : allowed });
  },
  onSuccess: () => { refetchStaffPages(); toast({ title: "Staff page access saved" }); },
});
```

```typescript
// inside the Admin component, alongside other queries:
const { data: staffPagesData, refetch: refetchStaffPages } = useQuery<{ staffAllowedPages: string[] | null }>({
  queryKey: ["/api/settings/staff-pages"],
});
const [staffPages, setStaffPages] = useState<Record<string, boolean>>({});

useEffect(() => {
  if (staffPagesData) {
    const allowed = staffPagesData.staffAllowedPages;
    const init: Record<string, boolean> = {};
    PAGE_ACCESS_LIST.forEach(p => { init[p.href] = allowed === null || allowed.includes(p.href); });
    setStaffPages(init);
  }
}, [staffPagesData]);

const saveStaffPagesMutation = useMutation({
  mutationFn: async (pages: Record<string, boolean>) => {
    const allowed = Object.entries(pages).filter(([, v]) => v).map(([href]) => href);
    const allOn = allowed.length === PAGE_ACCESS_LIST.length;
    return apiRequest("POST", "/api/settings/staff-pages", { staffAllowedPages: allOn ? null : allowed });
  },
  onSuccess: () => {
    refetchStaffPages();
    toast({ title: "Staff page access saved" });
  },
});
```

- [ ] **Step 4: Add PAGE_ACCESS_LIST constant (shared by manager + staff panels)**

Add this constant near the top of the file (after imports, before component definitions):

```typescript
const PAGE_ACCESS_LIST = [
  { label: "Tables",      href: "/tables" },
  { label: "Orders",      href: "/orders" },
  { label: "Billing",     href: "/billing" },
  { label: "KOT",         href: "/kot" },
  { label: "Staff",       href: "/staff" },
  { label: "Menu",        href: "/menu" },
  { label: "Inventory",   href: "/inventory" },
  { label: "Live Tables", href: "/live-tables" },
  { label: "Kitchen",     href: "/kitchen" },
  { label: "Customers",   href: "/customers" },
];
```

- [ ] **Step 5: Replace UsersTab + RolesTab with unified AccountsTab component**

Replace the existing `UsersTab` and `RolesTab` components with a single `AccountsTab`. Key structure:

```typescript
function AccountsTab() {
  const { data: users = [], refetch } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: staffList = [], refetch: refetchStaff } = useQuery<any[]>({ queryKey: ["/api/staff-members/all"] });

  // --- Add Account dialog state ---
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<User | null>(null);

  // --- Add Staff Member dialog state ---
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [editStaff, setEditStaff] = useState<any | null>(null);

  // --- Mutations: accounts ---
  const createAccount = useMutation({
    mutationFn: (data: { username: string; password: string; role: string; pin?: string }) =>
      apiRequest("POST", "/api/users", data),
    onSuccess: () => { refetch(); setShowAddAccount(false); toast({ title: "Account created" }); },
  });
  const updateAccount = useMutation({
    mutationFn: ({ id, ...data }: { id: number; username?: string; password?: string; role?: string; pin?: string }) =>
      apiRequest("PUT", `/api/users/${id}`, data),
    onSuccess: () => { refetch(); setEditAccount(null); toast({ title: "Account updated" }); },
  });
  const deleteAccount = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Account deleted" }); },
  });

  // --- Mutations: staff members ---
  const createStaffMember = useMutation({
    mutationFn: (data: { name: string; pin: string }) => apiRequest("POST", "/api/staff-members", data),
    onSuccess: () => { refetchStaff(); setShowAddStaff(false); toast({ title: "Staff member added" }); },
  });
  const updateStaffMember = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; pin?: string; isActive?: boolean }) =>
      apiRequest("PUT", `/api/staff-members/${id}`, data),
    onSuccess: () => { refetchStaff(); setEditStaff(null); toast({ title: "Staff member updated" }); },
  });
  const deleteStaffMember = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff-members/${id}`),
    onSuccess: () => { refetchStaff(); toast({ title: "Staff member removed" }); },
  });

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{users.length} accounts · {staffList.length} staff members</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddStaff(true)}>+ Add Staff Member</Button>
          <Button size="sm" onClick={() => setShowAddAccount(true)}>+ Add Account</Button>
        </div>
      </div>

      {/* Unified table */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Name / Username</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Role</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Login Type</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Mobile Card</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* System accounts */}
            {users.map(user => (
              <tr key={`user-${user.id}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{user.username}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${roleColors[user.role] ?? "bg-gray-100 text-gray-800"}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">Username + Password</td>
                <td className="px-4 py-3 text-gray-400 text-xs">—</td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button className="text-blue-500 text-xs hover:underline" onClick={() => setEditAccount(user)}>Edit</button>
                  <button className="text-red-400 text-xs hover:underline" onClick={() => deleteAccount.mutate(user.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {/* Staff members */}
            {staffList.map((s: any) => (
              <tr key={`staff-${s.id}`} className="hover:bg-purple-50 bg-purple-50/30">
                <td className="px-4 py-3 font-medium flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-purple-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {s.name[0].toUpperCase()}
                  </span>
                  {s.name}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${staffMemberColor}`}>
                    Staff Member
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">PIN only</td>
                <td className="px-4 py-3 text-xs">
                  {s.isActive ? <span className="text-green-600">✓ Shown</span> : <span className="text-gray-400">Hidden</span>}
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button className="text-blue-500 text-xs hover:underline" onClick={() => setEditStaff(s)}>Edit</button>
                  <button className="text-red-400 text-xs hover:underline" onClick={() => deleteStaffMember.mutate(s.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Account Dialog */}
      <AccountDialog
        open={showAddAccount || !!editAccount}
        initial={editAccount}
        onClose={() => { setShowAddAccount(false); setEditAccount(null); }}
        onSave={(data) => editAccount ? updateAccount.mutate({ id: editAccount.id, ...data }) : createAccount.mutate(data)}
      />

      {/* Add / Edit Staff Member Dialog */}
      <StaffMemberDialog
        open={showAddStaff || !!editStaff}
        initial={editStaff}
        onClose={() => { setShowAddStaff(false); setEditStaff(null); }}
        onSave={(data) => editStaff ? updateStaffMember.mutate({ id: editStaff.id, ...data }) : createStaffMember.mutate(data)}
      />
    </div>
  );
}
```

- [ ] **Step 6: Add AccountDialog component**

```typescript
function AccountDialog({
  open, initial, onClose, onSave,
}: {
  open: boolean;
  initial: User | null;
  onClose: () => void;
  onSave: (data: { username: string; password: string; role: string; pin?: string }) => void;
}) {
  const form = useForm({ defaultValues: { username: "", password: "", role: "staff", pin: "" } });
  useEffect(() => {
    if (initial) form.reset({ username: initial.username, password: "", role: initial.role, pin: initial.pin ?? "" });
    else form.reset({ username: "", password: "", role: "staff", pin: "" });
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Account" : "Add Account"}</DialogTitle>
          <DialogDescription>
            {initial ? "Update account details." : "Create a new login account."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((d) => onSave({ ...d, pin: d.pin || undefined }))} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Username</label>
            <Input {...form.register("username", { required: true })} placeholder="e.g. manager2" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">{initial ? "New Password (leave blank to keep)" : "Password"}</label>
            <Input type="password" {...form.register("password", { required: !initial })} placeholder="Min 6 characters" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <Select value={form.watch("role")} onValueChange={(v) => form.setValue("role", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="staff">Staff</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">PIN <span className="text-gray-400 font-normal">(optional, 4 or 6 digits — for POS role switching)</span></label>
            <Input {...form.register("pin")} placeholder="4 or 6 digits" maxLength={6} className="mt-1" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{initial ? "Save Changes" : "Create Account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Add StaffMemberDialog component**

```typescript
function StaffMemberDialog({
  open, initial, onClose, onSave,
}: {
  open: boolean;
  initial: any | null;
  onClose: () => void;
  onSave: (data: { name: string; pin: string }) => void;
}) {
  const form = useForm({ defaultValues: { name: "", pin: "", confirmPin: "" } });
  useEffect(() => {
    if (initial) form.reset({ name: initial.name, pin: "", confirmPin: "" });
    else form.reset({ name: "", pin: "", confirmPin: "" });
  }, [initial, open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Staff Member" : "Add Staff Member"}</DialogTitle>
          <DialogDescription>
            Staff members appear as name cards on the mobile login screen and log in with PIN.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((d) => {
            if (d.pin !== d.confirmPin) { form.setError("confirmPin", { message: "PINs don't match" }); return; }
            if (d.pin && (d.pin.length !== 4 && d.pin.length !== 6)) { form.setError("pin", { message: "PIN must be 4 or 6 digits" }); return; }
            onSave({ name: d.name, pin: d.pin });
          })}
          className="space-y-4"
        >
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input {...form.register("name", { required: true })} placeholder="e.g. Balawant" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">PIN <span className="text-gray-400 font-normal">(4 or 6 digits)</span></label>
            <Input type="password" {...form.register("pin")} placeholder="4 or 6 digits" maxLength={6} className="mt-1" />
            {form.formState.errors.pin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.pin.message}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">Confirm PIN</label>
            <Input type="password" {...form.register("confirmPin")} placeholder="Re-enter PIN" maxLength={6} className="mt-1" />
            {form.formState.errors.confirmPin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.confirmPin.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{initial ? "Save Changes" : "Add Staff Member"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Add RolePermissionsTab component**

This replaces the old Roles tab and includes both manager and staff page access panels. It uses the `PAGE_ACCESS_LIST` constant defined in Step 4 and the `staffPages`/`managerPages` state + mutations set up in Step 3 (passed as props from the parent Admin component):

```typescript
function RolePermissionsTab({
  managerPages, setManagerPages, saveManagerPages,
  staffPages, setStaffPages, saveStaffPages,
}: {
  managerPages: Record<string, boolean>;
  setManagerPages: (v: Record<string, boolean>) => void;
  saveManagerPages: () => void;
  staffPages: Record<string, boolean>;
  setStaffPages: (v: Record<string, boolean>) => void;
  saveStaffPages: () => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Admin — locked */}
      <div className="rounded-xl border border-gray-200 p-5 opacity-50">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Admin <span className="text-gray-400 font-normal text-xs">— always full access</span></h3>
        <p className="text-xs text-gray-400">Admin always has access to all pages. This cannot be changed.</p>
      </div>

      {/* Manager */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-5">
        <h3 className="font-semibold text-sm text-blue-700 mb-4">Manager</h3>
        <div className="space-y-3">
          {PAGE_ACCESS_LIST.map(p => (
            <div key={p.href} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{p.label}</span>
              <Switch
                checked={managerPages[p.href] ?? true}
                onCheckedChange={(checked) => setManagerPages({ ...managerPages, [p.href]: checked })}
              />
            </div>
          ))}
        </div>
        <Button className="w-full mt-4" size="sm" onClick={saveManagerPages}>Save Manager Access</Button>
      </div>

      {/* Staff */}
      <div className="rounded-xl border border-green-200 bg-green-50/30 p-5">
        <h3 className="font-semibold text-sm text-green-700 mb-4">Staff</h3>
        <div className="space-y-3">
          {PAGE_ACCESS_LIST.map(p => (
            <div key={p.href} className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{p.label}</span>
              <Switch
                checked={staffPages[p.href] ?? true}
                onCheckedChange={(checked) => setStaffPages({ ...staffPages, [p.href]: checked })}
              />
            </div>
          ))}
        </div>
        <Button className="w-full mt-4" size="sm" onClick={saveStaffPages}>Save Staff Access</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Update main Admin component tab structure**

In the main `Admin` component, replace the existing `TabsList` and `TabsContent` blocks for "users" and "roles" with the new "accounts" and "role-permissions" tabs. Keep the "profile" and "password" tabs unchanged:

```tsx
<TabsList>
  {isAdmin && <TabsTrigger value="accounts"><Users className="w-4 h-4 mr-1.5" />Accounts</TabsTrigger>}
  {isAdmin && <TabsTrigger value="role-permissions"><ShieldCheck className="w-4 h-4 mr-1.5" />Role Permissions</TabsTrigger>}
  <TabsTrigger value="profile"><UserIcon className="w-4 h-4 mr-1.5" />Profile</TabsTrigger>
  <TabsTrigger value="password"><KeyRound className="w-4 h-4 mr-1.5" />Password</TabsTrigger>
</TabsList>

{isAdmin && (
  <TabsContent value="accounts" className="mt-6">
    <AccountsTab />
  </TabsContent>
)}
{isAdmin && (
  <TabsContent value="role-permissions" className="mt-6">
    <RolePermissionsTab
      managerPages={managerPages}
      setManagerPages={setManagerPages}
      saveManagerPages={() => saveManagerPagesMutation.mutate(managerPages)}
      staffPages={staffPages}
      setStaffPages={setStaffPages}
      saveStaffPages={() => saveStaffPagesMutation.mutate(staffPages)}
    />
  </TabsContent>
)}
{/* profile and password TabsContent stay here unchanged */}
```

Also update the default tab value from `"users"` to `"accounts"`:
```tsx
<Tabs defaultValue={isAdmin ? "accounts" : "profile"}>
```

- [ ] **Step 10: Run TypeScript check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add client/src/pages/Admin.tsx
git commit -m "feat: rewrite Admin page — unified Accounts tab + Role Permissions tab with staff access"
```

---

## Task 4: Remove migrated sections from Settings

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: Remove Staff Selector panel**

In `client/src/pages/Settings.tsx`, find the Staff Selector panel section (around lines 864–1112). It starts with a comment like `{/* Staff Selector */}` or a section heading "Staff Selector". Delete the entire block including all related state variables, refs, mutations, and JSX.

Also remove the associated state variables declared near the top of the Settings component:
- `staffMembers` query
- `showAddStaff`, `editingStaff` state
- `addStaffMutation`, `updateStaffMutation`, `deleteStaffMutation`
- Any `staffPin`, `staffConfirmPin`, `newStaffName` state

- [ ] **Step 2: Remove Manager Page Access panel**

In `client/src/pages/Settings.tsx`, find the Manager Page Access panel (around lines 1129–1198). Delete the entire block.

Also remove the associated state variables:
- `managerPagesData` query
- `managerPageToggles` state
- `saveManagerPagesMutation`
- `PAGE_LIST` constant if it was defined locally in Settings (it's now in Admin.tsx)

- [ ] **Step 3: Run TypeScript check**

```bash
npm run check
```

Expected: no errors (all removed code had no external consumers).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Settings.tsx
git commit -m "refactor: remove Staff Selector and Manager Page Access from Settings — now in Admin page"
```

---

## Task 5: Fix Login page — show staff cards on all mobile, not just local network

**Files:**
- Modify: `client/src/pages/Login.tsx`

**Context:** The `StaffSelector` component (lines 191–418) already implements the full mobile staff-card UI — staff grid, PIN entry, "Manager / Admin Login →" toggle, "← Back" button, and empty-state fallback. It's complete and well-built.

The **only problem** is the gate condition at line 439:

```typescript
// Current — only shows on LOCAL NETWORK mobile devices
if (ctx?.isLocalNetwork && ctx?.isMobile) {
  return <StaffSelector onLoginSuccess={onLoginSuccess} />;
}
```

This blocks staff cards when accessed from Vercel (not local network). The `isLocalNetwork` check must be removed so any mobile device — local or remote — sees the staff selector.

- [ ] **Step 1: Remove isLocalNetwork from the gate condition**

In `client/src/pages/Login.tsx`, change line 439:

```typescript
// Before:
if (ctx?.isLocalNetwork && ctx?.isMobile) {

// After:
if (ctx?.isMobile) {
```

That single word removal is the entire change. The `StaffSelector` already handles everything else:
- Staff cards with gradient avatars and tap → PIN flow
- "Manager / Admin Login →" toggles to username+password form
- "← Back" returns to staff cards
- Empty state if no staff members ("No staff accounts found. Ask admin to create accounts.")
- Desktop: untouched (the `isMobile` check still gates it correctly)

- [ ] **Step 2: Update the "Manager Login" label to "Manager / Admin Login" for clarity**

In `StaffSelector` at line 284, the heading reads "Manager Login". Update it to be clearer:

```tsx
// Before (line 284):
<h2 className="text-lg font-bold text-gray-900 tracking-tight">Manager Login</h2>
<p className="text-xs text-gray-600 mt-0.5">Restricted access — credentials required</p>

// After:
<h2 className="text-lg font-bold text-gray-900 tracking-tight">Manager / Admin Login</h2>
<p className="text-xs text-gray-600 mt-0.5">Enter your username and password to continue</p>
```

- [ ] **Step 3: Run TypeScript check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Login.tsx
git commit -m "feat: show staff card selector on all mobile devices, not just local network"
```

---

## Task 6: Verify-pin hierarchy update for staff role

**Files:**
- Modify: `server/routes.ts`

The verify-pin endpoint at line ~437 needs to accept staff-role PINs when switching to "staff". Currently it only handles admin/manager in the hierarchy.

- [ ] **Step 1: Update verify-pin hierarchy comment**

In `server/routes.ts` at the verify-pin endpoint (~line 437), ensure the role hierarchy logic includes "staff":

```typescript
// Role hierarchy for PIN acceptance:
// "admin"   → only admin PINs accepted
// "manager" → manager OR admin PINs accepted
// "staff"   → staff, manager, OR admin PINs accepted
const acceptableRoles =
  requiredRole === "admin"   ? ["admin"] :
  requiredRole === "manager" ? ["manager", "admin"] :
  requiredRole === "staff"   ? ["staff", "manager", "admin"] :
  [requiredRole];

const match = allUsers.find(u => acceptableRoles.includes(u.role) && u.pin === pin);
res.json({ valid: !!match });
```

- [ ] **Step 2: Run TypeScript check + commit**

```bash
npm run check
git add server/routes.ts
git commit -m "fix: verify-pin accepts staff/manager/admin PINs when switching to staff role"
```

---

## Final Verification

- [ ] `npm run dev` — start dev server

- [ ] **Admin → Accounts tab**: Create a staff account (role=staff, username/password), create a staff member (name+PIN). Verify both appear in the unified table with correct badges.

- [ ] **Admin → Role Permissions tab**: Toggle off some pages for Manager and Staff separately. Click Save. Log in as manager — confirm hidden pages are gone from TopNav. Log in as staff account — confirm staff-restricted pages are hidden.

- [ ] **Settings page**: Confirm Staff Selector and Manager Page Access sections are gone.

- [ ] **Mobile login (375px viewport in DevTools)**: Confirm staff name cards appear. Tap a card, enter PIN, confirm login succeeds with staff-level page access.

- [ ] **Mobile — Manager / Admin Login**: Tap the link, confirm username+password form appears. Tap "← Back", confirm cards reappear.

- [ ] **Desktop login (1280px viewport)**: Confirm no staff cards, standard Sign In form works for admin/manager/staff accounts.

- [ ] `npm run check` — TypeScript clean with zero errors.
