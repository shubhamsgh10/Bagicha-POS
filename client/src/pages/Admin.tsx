import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, User as UserIcon, KeyRound, Users, ShieldCheck,
} from "lucide-react";
import type { User } from "@shared/schema";

// ── Schemas ──────────────────────────────────────────────────────────────────

const usernameSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type UsernameForm = z.infer<typeof usernameSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

const roleColors: Record<string, string> = {
  admin:   "bg-amber-100 text-amber-800",
  manager: "bg-blue-100 text-blue-800",
  staff:   "bg-green-100 text-green-800",
};

const staffMemberColor = "bg-purple-100 text-purple-800";

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

// ── Helper ────────────────────────────────────────────────────────────────────

function parseError(err: any): string {
  const raw: string = err?.message ?? "";
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (parsed?.message) return parsed.message;
    } catch {}
  }
  return raw || "Something went wrong";
}

// ── Accounts Tab ──────────────────────────────────────────────────────────────

function AccountsTab() {
  const { toast } = useToast();
  const { data: users = [] } = useQuery<User[]>({ queryKey: ["/api/users"] });
  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff-members/all"] });

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<User | null>(null);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [editStaff, setEditStaff] = useState<any | null>(null);

  const createAccount = useMutation({
    mutationFn: (data: { username: string; password: string; role: string; pin?: string }) =>
      apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/switchable-roles"] });
      setShowAddAccount(false);
      toast({ title: "Account created" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create account", description: parseError(err), variant: "destructive" });
    },
  });
  const updateAccount = useMutation({
    mutationFn: ({ id, ...data }: { id: number; username?: string; password?: string; role?: string; pin?: string }) =>
      apiRequest("PUT", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/switchable-roles"] });
      setEditAccount(null);
      toast({ title: "Account updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update account", description: parseError(err), variant: "destructive" });
    },
  });
  const deleteAccount = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/switchable-roles"] });
      toast({ title: "Account deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete account", description: parseError(err), variant: "destructive" });
    },
  });

  const createStaffMember = useMutation({
    mutationFn: (data: { name: string; pin: string }) => apiRequest("POST", "/api/staff-members", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff-members/all"] }); setShowAddStaff(false); toast({ title: "Staff member added" }); },
    onError: (err: any) => {
      toast({ title: "Failed to add staff member", description: parseError(err), variant: "destructive" });
    },
  });
  const updateStaffMember = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; pin?: string; isActive?: boolean }) =>
      apiRequest("PUT", `/api/staff-members/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff-members/all"] }); setEditStaff(null); toast({ title: "Staff member updated" }); },
    onError: (err: any) => {
      toast({ title: "Failed to update staff member", description: parseError(err), variant: "destructive" });
    },
  });
  const deleteStaffMember = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff-members/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff-members/all"] }); toast({ title: "Staff member removed" }); },
    onError: (err: any) => {
      toast({ title: "Failed to remove staff member", description: parseError(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500">{users.length} accounts · {staffList.length} staff members</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddStaff(true)}>+ Add Staff Member</Button>
          <Button size="sm" onClick={() => setShowAddAccount(true)}>+ Add Account</Button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
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
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button className="text-blue-500 text-xs hover:underline" onClick={() => setEditAccount(user)}>Edit</button>
                  <button
                    className="text-red-400 text-xs hover:underline"
                    onClick={() => {
                      if (confirm(`Delete account "${user.username}"?`)) deleteAccount.mutate(user.id);
                    }}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {staffList.map((s: any) => (
              <tr key={`staff-${s.id}`} className="hover:bg-purple-50 bg-purple-50/30">
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-purple-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {s.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                    {s.name}
                  </div>
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
                <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                  <button className="text-blue-500 text-xs hover:underline" onClick={() => setEditStaff(s)}>Edit</button>
                  <button
                    className="text-red-400 text-xs hover:underline"
                    onClick={() => {
                      if (confirm(`Remove staff member "${s.name}"?`)) deleteStaffMember.mutate(s.id);
                    }}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && staffList.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No accounts or staff members yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AccountDialog
        open={showAddAccount || !!editAccount}
        initial={editAccount}
        onClose={() => { setShowAddAccount(false); setEditAccount(null); }}
        onSave={(data) => editAccount ? updateAccount.mutate({ id: editAccount.id, ...data }) : createAccount.mutate(data)}
        isPending={createAccount.isPending || updateAccount.isPending}
      />

      <StaffMemberDialog
        open={showAddStaff || !!editStaff}
        initial={editStaff}
        onClose={() => { setShowAddStaff(false); setEditStaff(null); }}
        onSave={(data) => editStaff ? updateStaffMember.mutate({ id: editStaff.id, ...data }) : createStaffMember.mutate(data)}
        isPending={createStaffMember.isPending || updateStaffMember.isPending}
      />
    </div>
  );
}

// ── Account Dialog ────────────────────────────────────────────────────────────

function AccountDialog({
  open, initial, onClose, onSave, isPending,
}: {
  open: boolean;
  initial: User | null;
  onClose: () => void;
  onSave: (data: { username: string; password: string; role: string; pin?: string }) => void;
  isPending?: boolean;
}) {
  const form = useForm({ defaultValues: { username: "", password: "", role: "staff", pin: "" } });
  useEffect(() => {
    if (initial) form.reset({ username: initial.username, password: "", role: initial.role, pin: (initial as any).pin ?? "" });
    else form.reset({ username: "", password: "", role: "staff", pin: "" });
  }, [initial, open, form]);

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
            <Input {...form.register("pin", {
              validate: (v) => !v || /^\d{4}$|\d{6}$/.test(v) || "PIN must be exactly 4 or 6 digits",
            })} placeholder="4 or 6 digits" maxLength={6} inputMode="numeric" className="mt-1" />
            {form.formState.errors.pin && (
              <p className="text-xs text-red-500 mt-1">{form.formState.errors.pin.message as string}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{initial ? "Save Changes" : "Create Account"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Staff Member Dialog ───────────────────────────────────────────────────────

function StaffMemberDialog({
  open, initial, onClose, onSave, isPending,
}: {
  open: boolean;
  initial: any | null;
  onClose: () => void;
  onSave: (data: { name: string; pin: string }) => void;
  isPending?: boolean;
}) {
  const form = useForm({ defaultValues: { name: "", pin: "", confirmPin: "" } });
  useEffect(() => {
    if (initial) form.reset({ name: initial.name, pin: "", confirmPin: "" });
    else form.reset({ name: "", pin: "", confirmPin: "" });
  }, [initial, open, form]);

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
            if (!initial && !d.pin) { form.setError("pin", { message: "PIN is required" }); return; }
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
            <Input type="password" inputMode="numeric" {...form.register("pin")} placeholder="4 or 6 digits" maxLength={6} className="mt-1" />
            {form.formState.errors.pin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.pin.message as string}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">Confirm PIN</label>
            <Input type="password" inputMode="numeric" {...form.register("confirmPin")} placeholder="Re-enter PIN" maxLength={6} className="mt-1" />
            {form.formState.errors.confirmPin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.confirmPin.message as string}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{initial ? "Save Changes" : "Add Staff Member"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Role Permissions Tab ──────────────────────────────────────────────────────

function RolePermissionsTab({
  managerPages, setManagerPages, saveManagerPages,
  staffPages, setStaffPages, saveStaffPages,
  savingManager, savingStaff,
}: {
  managerPages: Record<string, boolean>;
  setManagerPages: (v: Record<string, boolean>) => void;
  saveManagerPages: () => void;
  staffPages: Record<string, boolean>;
  setStaffPages: (v: Record<string, boolean>) => void;
  saveStaffPages: () => void;
  savingManager?: boolean;
  savingStaff?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="rounded-xl border border-gray-200 p-5 opacity-50">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Admin <span className="text-gray-400 font-normal text-xs">— always full access</span></h3>
        <p className="text-xs text-gray-400">Admin always has access to all pages. This cannot be changed.</p>
      </div>

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
        <Button className="w-full mt-4" size="sm" onClick={saveManagerPages} disabled={savingManager}>Save Manager Access</Button>
      </div>

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
        <Button className="w-full mt-4" size="sm" onClick={saveStaffPages} disabled={savingStaff}>Save Staff Access</Button>
      </div>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  const isAdmin = user?.role === "admin";

  // Manager pages
  const { data: managerPagesData, refetch: refetchManagerPages } = useQuery<{ managerAllowedPages: string[] | null }>({
    queryKey: ["/api/settings/manager-pages"],
    enabled: isAdmin,
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
    onError: (err: any) => {
      toast({ title: "Failed to save", description: parseError(err), variant: "destructive" });
    },
  });

  // Staff pages
  const { data: staffPagesData, refetch: refetchStaffPages } = useQuery<{ staffAllowedPages: string[] | null }>({
    queryKey: ["/api/settings/staff-pages"],
    enabled: isAdmin,
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
    onError: (err: any) => {
      toast({ title: "Failed to save", description: parseError(err), variant: "destructive" });
    },
  });

  const usernameForm = useForm<UsernameForm>({
    resolver: zodResolver(usernameSchema),
    defaultValues: { username: user?.username ?? "" },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onUsernameSubmit = async (data: UsernameForm) => {
    setUsernameLoading(true);
    try {
      await apiRequest("PUT", "/api/auth/profile", { username: data.username });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Username updated successfully" });
    } catch (err: any) {
      toast({ title: "Failed to update username", description: parseError(err), variant: "destructive" });
    } finally {
      setUsernameLoading(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordForm) => {
    setPasswordLoading(true);
    try {
      await apiRequest("PUT", "/api/auth/password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      passwordForm.reset();
      toast({ title: "Password changed successfully" });
    } catch (err: any) {
      toast({ title: "Failed to change password", description: parseError(err), variant: "destructive" });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" style={{ background: "transparent" }}>
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-1">Manage accounts, role permissions, and your profile</p>
      </div>

      <Tabs defaultValue={isAdmin ? "accounts" : "profile"}>
        <TabsList className={`flex w-full overflow-x-auto rounded-xl p-1`}
          style={{
            background: "rgba(255,255,255,0.50)",
            backdropFilter: "blur(16px) saturate(1.8)",
            WebkitBackdropFilter: "blur(16px) saturate(1.8)",
            border: "1px solid rgba(255,255,255,0.70)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,0.9) inset",
          }}>
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
              savingManager={saveManagerPagesMutation.isPending}
              savingStaff={saveStaffPagesMutation.isPending}
            />
          </TabsContent>
        )}

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-6">
          <div className="rounded-2xl p-5"
            style={{
              background: "rgba(255,255,255,0.55)",
              backdropFilter: "blur(18px) saturate(1.8)",
              WebkitBackdropFilter: "blur(18px) saturate(1.8)",
              border: "1px solid rgba(255,255,255,0.72)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.92) inset",
            }}>
            <div className="flex items-center gap-2 mb-1">
              <UserIcon className="w-5 h-5 text-emerald-600" />
              <h3 className="font-semibold text-gray-800">Change Username</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">Update the username used to sign in</p>
            <form onSubmit={usernameForm.handleSubmit(onUsernameSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>New Username</Label>
                <Input placeholder="Enter new username" {...usernameForm.register("username")} className="bg-white/60 border-white/50" />
                {usernameForm.formState.errors.username && (
                  <p className="text-xs text-destructive">{usernameForm.formState.errors.username.message}</p>
                )}
              </div>
              <Button type="submit" disabled={usernameLoading} className="bg-gradient-to-r from-emerald-500 to-green-500 text-white border-0">
                {usernameLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Username"}
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* Password Tab */}
        <TabsContent value="password" className="mt-6">
          <div className="rounded-2xl p-5"
            style={{
              background: "rgba(255,255,255,0.55)",
              backdropFilter: "blur(18px) saturate(1.8)",
              WebkitBackdropFilter: "blur(18px) saturate(1.8)",
              border: "1px solid rgba(255,255,255,0.72)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.92) inset",
            }}>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="w-5 h-5 text-emerald-600" />
              <h3 className="font-semibold text-gray-800">Change Password</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">Choose a strong password with at least 6 characters</p>
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <Input type="password" placeholder="••••••••" autoComplete="current-password" {...passwordForm.register("currentPassword")} className="bg-white/60 border-white/50" />
                {passwordForm.formState.errors.currentPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.currentPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input type="password" placeholder="••••••••" autoComplete="new-password" {...passwordForm.register("newPassword")} className="bg-white/60 border-white/50" />
                {passwordForm.formState.errors.newPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.newPassword.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input type="password" placeholder="••••••••" autoComplete="new-password" {...passwordForm.register("confirmPassword")} className="bg-white/60 border-white/50" />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" disabled={passwordLoading} className="bg-gradient-to-r from-emerald-500 to-green-500 text-white border-0">
                {passwordLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Changing...</> : "Change Password"}
              </Button>
            </form>
          </div>
        </TabsContent>

      </Tabs>
    </div>
    </div>
  );
}
