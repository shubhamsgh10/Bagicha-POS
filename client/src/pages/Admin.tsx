import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRoleContext } from "@/context/ActiveRoleContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, User, KeyRound, Users, Plus, Trash2, Shield, ShieldCheck,
  Calendar, Clock, Upload, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, UserCheck, FileText, DollarSign, ClipboardList,
} from "lucide-react";

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

const newUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["admin", "manager", "cashier", "kitchen", "staff"]),
});

type UsernameForm = z.infer<typeof usernameSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;
type NewUserForm = z.infer<typeof newUserSchema>;

const ROLES = ["admin", "manager", "cashier", "kitchen", "staff"] as const;

const roleColors: Record<string, string> = {
  admin: "bg-red-100 text-red-800",
  manager: "bg-blue-100 text-blue-800",
  cashier: "bg-green-100 text-green-800",
  kitchen: "bg-orange-100 text-orange-800",
  staff: "bg-gray-100 text-gray-800",
};

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

// ── Users Tab (username & password management only) ───────────────────────────

function UsersTab() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [showAddUser, setShowAddUser] = useState(false);

  const { data: users, isLoading } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const newUserForm = useForm<NewUserForm>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { username: "", password: "", role: "staff" },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: NewUserForm) => apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      toast({ title: "User created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowAddUser(false);
      newUserForm.reset();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create user", description: parseError(err), variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      toast({ title: "User deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete user", description: parseError(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{users?.length || 0} users in the system</p>
        <Button size="sm" onClick={() => setShowAddUser(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 skeleton-glass" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {users?.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-xl transition-all duration-200 hover:scale-[1.005]"
              style={{
                background: "rgba(255,255,255,0.55)",
                backdropFilter: "blur(16px) saturate(1.8)",
                WebkitBackdropFilter: "blur(16px) saturate(1.8)",
                border: "1px solid rgba(255,255,255,0.72)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
              }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{u.username}</p>
                  <p className="text-xs text-muted-foreground">
                    Joined {new Date(u.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleColors[u.role] || roleColors.staff}`}>
                  {u.role}
                </span>
                {u.id === currentUser?.id ? (
                  <Badge variant="outline" className="text-xs">You</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete user "${u.username}"?`)) deleteUserMutation.mutate(u.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account</DialogDescription>
          </DialogHeader>
          <form onSubmit={newUserForm.handleSubmit((d) => createUserMutation.mutate(d))} className="space-y-4">
            <div className="space-y-2">
              <Label>Username</Label>
              <Input {...newUserForm.register("username")} placeholder="Enter username" />
              {newUserForm.formState.errors.username && (
                <p className="text-xs text-destructive">{newUserForm.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input {...newUserForm.register("password")} type="password" placeholder="Min 6 characters" />
              {newUserForm.formState.errors.password && (
                <p className="text-xs text-destructive">{newUserForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Initial Role</Label>
              <Select
                value={newUserForm.watch("role")}
                onValueChange={(v) => newUserForm.setValue("role", v as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowAddUser(false)}>Cancel</Button>
              <Button type="submit" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</> : "Create User"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [pinDialogUser, setPinDialogUser] = useState<any | null>(null);
  const [pinDialogMode, setPinDialogMode] = useState<"set" | "remove">("set");
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinDialogError, setPinDialogError] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);
  const [addForm, setAddForm] = useState({ username: "", password: "", role: "staff", pin: "", pinConfirm: "" });
  const [addFormError, setAddFormError] = useState("");

  const { data: users = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) =>
      apiRequest("PUT", `/api/users/${id}`, { role }),
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update role", description: parseError(err), variant: "destructive" });
    },
  });

  const setPinMutation = useMutation({
    mutationFn: async ({ id, pin }: { id: number; pin: string | null }) =>
      apiRequest("PUT", `/api/users/${id}/pin`, { pin }),
    onSuccess: () => {
      toast({ title: pinDialogMode === "remove" ? "PIN removed" : "PIN updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setPinDialogUser(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update PIN", description: parseError(err), variant: "destructive" });
    },
  });

  const resetAllPinsMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/users/reset-all-pins", {}),
    onSuccess: () => {
      toast({ title: "All PINs cleared" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setResetConfirm(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to reset PINs", description: parseError(err), variant: "destructive" });
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: async (data: typeof addForm) =>
      apiRequest("POST", "/api/users", {
        username: data.username.trim(),
        password: data.password,
        role: data.role,
        pin: data.pin || undefined,
      }),
    onSuccess: () => {
      toast({ title: "Role created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/switchable-roles"] });
      setShowAddRole(false);
      setAddForm({ username: "", password: "", role: "staff", pin: "", pinConfirm: "" });
      setAddFormError("");
    },
    onError: (err: any) => {
      setAddFormError(parseError(err));
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      toast({ title: "User deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/switchable-roles"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete user", description: parseError(err), variant: "destructive" });
    },
  });

  const handleAddRole = () => {
    setAddFormError("");
    if (!addForm.username.trim()) { setAddFormError("Username is required"); return; }
    if (addForm.password.length < 6) { setAddFormError("Password must be at least 6 characters"); return; }
    if (addForm.pin) {
      if (addForm.pin.length !== 4 && addForm.pin.length !== 6) { setAddFormError("PIN must be 4 or 6 digits"); return; }
      if (addForm.pin !== addForm.pinConfirm) { setAddFormError("PINs do not match"); return; }
    }
    createRoleMutation.mutate(addForm);
  };

  const openPinDialog = (user: any, mode: "set" | "remove") => {
    setPinDialogUser(user);
    setPinDialogMode(mode);
    setNewPin("");
    setNewPinConfirm("");
    setPinDialogError("");
  };

  const handlePinSave = () => {
    if (pinDialogMode === "remove") {
      setPinMutation.mutate({ id: pinDialogUser.id, pin: null });
      return;
    }
    if (newPin.length !== 4 && newPin.length !== 6) { setPinDialogError("PIN must be 4 or 6 digits"); return; }
    if (newPin !== newPinConfirm) { setPinDialogError("PINs do not match"); return; }
    setPinMutation.mutate({ id: pinDialogUser.id, pin: newPin });
  };

  const roleDescriptions: Record<string, string> = {
    admin: "Full access to all features",
    manager: "Menu, orders, reports & POS",
    cashier: "POS & billing only",
    kitchen: "KOT & kitchen display",
    staff: "Basic POS access",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">Assign roles and manage POS PINs for each user</p>
        <div className="flex items-center gap-2 flex-wrap">
          {resetConfirm ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600 font-medium">Sure? This clears all PINs.</span>
              <Button size="sm" variant="destructive" disabled={resetAllPinsMutation.isPending}
                onClick={() => resetAllPinsMutation.mutate()}>
                {resetAllPinsMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Resetting...</> : "Yes, Reset"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResetConfirm(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="text-destructive border-red-200 hover:bg-red-50"
              onClick={() => setResetConfirm(true)}>
              Reset All PINs
            </Button>
          )}
          <Button size="sm" onClick={() => { setShowAddRole(true); setAddFormError(""); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Role
          </Button>
        </div>
      </div>

      {/* Role legend */}
      <div className="rounded-2xl"
        style={{
          background: "rgba(255,255,255,0.46)",
          backdropFilter: "blur(16px) saturate(1.7)",
          WebkitBackdropFilter: "blur(16px) saturate(1.7)",
          border: "1px solid rgba(255,255,255,0.68)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,0.9) inset",
        }}>
        <div className="pt-4 pb-3 px-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Role Permissions</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ROLES.map(r => (
              <div key={r} className="flex items-start gap-2">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${roleColors[r]}`}>{r}</span>
                <span className="text-xs text-muted-foreground">{roleDescriptions[r]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 skeleton-glass" />)}
        </div>
      ) : (
        <>
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No users found. Make sure you are logged in as admin.</p>
        )}
        <div className="space-y-2">
          {users.map((u: any) => (
            <div key={u.id} className="rounded-xl p-4 space-y-3 transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.55)",
                backdropFilter: "blur(16px) saturate(1.8)",
                WebkitBackdropFilter: "blur(16px) saturate(1.8)",
                border: "1px solid rgba(255,255,255,0.72)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
              }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{u.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.pin ? <span className="text-green-600 flex items-center gap-1"><Shield className="w-3 h-3" />PIN set</span> : <span className="text-muted-foreground">No PIN</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.id === currentUser?.id && <Badge variant="outline" className="text-xs">You</Badge>}
                  {u.id !== currentUser?.id && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-red-50"
                      onClick={() => { if (confirm(`Delete "${u.username}"?`)) deleteUserMutation.mutate(u.id); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Role selector */}
                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                  <Label className="text-xs text-muted-foreground shrink-0">Role:</Label>
                  <Select
                    value={u.role}
                    onValueChange={(v) => updateRoleMutation.mutate({ id: u.id, role: v })}
                    disabled={u.id === currentUser?.id}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => (
                        <SelectItem key={r} value={r} className="text-xs capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* PIN buttons — all users */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                    onClick={() => openPinDialog(u, "set")}
                  >
                    <Shield className="w-3 h-3" />
                    {u.pin ? "Change PIN" : "Set PIN"}
                  </Button>
                  {u.pin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 text-destructive border-red-200 hover:bg-red-50"
                      onClick={() => openPinDialog(u, "remove")}
                    >
                      Remove PIN
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Add Role Dialog */}
      <Dialog open={showAddRole} onOpenChange={(o) => { setShowAddRole(o); setAddFormError(""); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" /> Add Role
            </DialogTitle>
            <DialogDescription>Create a new user with a role and optional PIN.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input placeholder="e.g. manager2" value={addForm.username}
                onChange={(e) => setAddForm(f => ({ ...f, username: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" placeholder="Min 6 characters" value={addForm.password}
                onChange={(e) => setAddForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={addForm.role} onValueChange={(v) => setAddForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>PIN <span className="text-muted-foreground font-normal text-xs">(optional, 4 or 6 digits)</span></Label>
              <Input type="password" inputMode="numeric" maxLength={6} placeholder="4 or 6 digits"
                value={addForm.pin}
                onChange={(e) => setAddForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} />
            </div>
            {addForm.pin.length > 0 && (
              <div className="space-y-1.5">
                <Label>Confirm PIN</Label>
                <Input type="password" inputMode="numeric" maxLength={6} placeholder="Re-enter PIN"
                  value={addForm.pinConfirm}
                  onChange={(e) => setAddForm(f => ({ ...f, pinConfirm: e.target.value.replace(/\D/g, "") }))} />
              </div>
            )}
            {addFormError && <p className="text-xs text-destructive">{addFormError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowAddRole(false)}>Cancel</Button>
              <Button disabled={createRoleMutation.isPending} onClick={handleAddRole}>
                {createRoleMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Role"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PIN Dialog */}
      <Dialog open={!!pinDialogUser} onOpenChange={() => setPinDialogUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              {pinDialogMode === "remove" ? "Remove PIN" : pinDialogUser?.pin ? "Change PIN" : "Set PIN"}
            </DialogTitle>
            <DialogDescription>
              {pinDialogMode === "remove"
                ? `Remove the PIN for "${pinDialogUser?.username}".`
                : `${pinDialogUser?.pin ? "Change" : "Set a"} 4 or 6-digit PIN for "${pinDialogUser?.username}".`}
            </DialogDescription>
          </DialogHeader>
          {pinDialogMode === "remove" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Are you sure you want to remove this user's PIN?</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPinDialogUser(null)}>Cancel</Button>
                <Button variant="destructive" disabled={setPinMutation.isPending} onClick={handlePinSave}>
                  {setPinMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Removing...</> : "Remove PIN"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>New PIN</Label>
                <Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="4 or 6 digits"
                  value={newPin} onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "")); setPinDialogError(""); }} />
              </div>
              <div className="space-y-2">
                <Label>Confirm PIN</Label>
                <Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="Re-enter PIN"
                  value={newPinConfirm} onChange={(e) => { setNewPinConfirm(e.target.value.replace(/\D/g, "")); setPinDialogError(""); }} />
              </div>
              {pinDialogError && <p className="text-xs text-destructive">{pinDialogError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPinDialogUser(null)}>Cancel</Button>
                <Button disabled={setPinMutation.isPending || !newPin} onClick={handlePinSave}>
                  {setPinMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : "Save PIN"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Attendance Tab ────────────────────────────────────────────────────────────

const statusColor: Record<string, string> = {
  present:   "bg-green-100 text-green-800",
  absent:    "bg-red-100 text-red-800",
  "half-day":"bg-yellow-100 text-yellow-800",
  "on-leave":"bg-blue-100 text-blue-800",
  holiday:   "bg-purple-100 text-purple-800",
};

const glassStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(16px) saturate(1.8)",
  WebkitBackdropFilter: "blur(16px) saturate(1.8)",
  border: "1px solid rgba(255,255,255,0.72)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
};

function AttendanceTab() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"today" | "date" | "monthly">("today");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [importResult, setImportResult] = useState<{ imported: number; unmatched: string[] } | null>(null);
  const [overrideDialog, setOverrideDialog] = useState<any | null>(null);
  const [manualDialog, setManualDialog] = useState(false);
  const [overrideForm, setOverrideForm] = useState({ status: "present", clockIn: "", clockOut: "", notes: "" });
  const [manualForm, setManualForm] = useState({ userId: "", date: new Date().toISOString().split('T')[0], status: "present", clockIn: "", clockOut: "", notes: "" });

  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });

  const attendanceQueryKey = viewMode === "monthly"
    ? `/api/attendance?month=${selectedMonth}`
    : `/api/attendance?date=${selectedDate}`;

  const { data: attendanceData = [], isLoading: attLoading } = useQuery<any[]>({ queryKey: [attendanceQueryKey] });
  const { data: reportData = [] } = useQuery<any[]>({
    queryKey: [`/api/attendance/report?month=${selectedMonth}`],
    enabled: viewMode === "monthly",
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      apiRequest("PUT", `/api/attendance/${id}`, data),
    onSuccess: () => {
      toast({ title: "Attendance updated" });
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      setOverrideDialog(null);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const manualMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/attendance/manual", data),
    onSuccess: () => {
      toast({ title: "Attendance marked" });
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      setManualDialog(false);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/attendance/import", { method: "POST", body: formData, credentials: "include" });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: [attendanceQueryKey] });
      toast({ title: `Imported ${result.imported} records` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    }
    e.target.value = "";
  };

  const todayBoard = staffList.map((staff: any) => ({
    ...staff,
    attendance: attendanceData.find((a: any) => a.userId === staff.userId),
  }));

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/60" style={{ background: "rgba(255,255,255,0.4)" }}>
          {(["today","date","monthly"] as const).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${viewMode === m ? "bg-white/80 shadow-sm text-gray-900" : "text-gray-600"}`}>
              {m === "today" ? "Today" : m === "date" ? "By Date" : "Monthly"}
            </button>
          ))}
        </div>
        {viewMode === "date" && (
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        )}
        {viewMode === "monthly" && (
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => setManualDialog(true)}>
            <UserCheck className="w-3.5 h-3.5" /> Manual
          </Button>
          <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-white/60 bg-white/60 hover:bg-white/80 transition-colors">
            <Upload className="w-3.5 h-3.5" /> Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          </label>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className="rounded-xl p-3" style={glassStyle}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-green-700">Imported {importResult.imported} records</p>
              {importResult.unmatched.length > 0 && (
                <p className="text-xs text-orange-600 mt-1">Unmatched staff (set Biometric ID in Payroll tab): {importResult.unmatched.join(", ")}</p>
              )}
            </div>
            <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 ml-4">x</button>
          </div>
        </div>
      )}

      {/* Monthly summary table */}
      {viewMode === "monthly" && (
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left p-3 font-semibold">Staff</th>
                  <th className="text-center p-3 font-semibold">Role</th>
                  <th className="text-center p-3 font-semibold text-green-700">Present</th>
                  <th className="text-center p-3 font-semibold text-yellow-700">Half-day</th>
                  <th className="text-center p-3 font-semibold text-blue-700">Leave</th>
                  <th className="text-center p-3 font-semibold text-red-700">Absent</th>
                  <th className="text-center p-3 font-semibold">Hours</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((row: any) => (
                  <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                    <td className="p-3 font-medium">{row.username}</td>
                    <td className="p-3 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span></td>
                    <td className="p-3 text-center font-semibold text-green-700">{row.present}</td>
                    <td className="p-3 text-center text-yellow-700">{row.halfDay}</td>
                    <td className="p-3 text-center text-blue-700">{row.onLeave}</td>
                    <td className="p-3 text-center text-red-700">{row.absent}</td>
                    <td className="p-3 text-center">{row.totalHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Daily view (today + by-date) */}
      {viewMode !== "monthly" && (
        <>
          {attLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{[...Array(6)].map((_,i) => <div key={i} className="h-20 rounded-xl bg-white/40" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {todayBoard.map((staff: any) => {
                  const att = staff.attendance;
                  const status = att?.status ?? "not-marked";
                  return (
                    <div key={staff.userId} className="rounded-xl p-3 space-y-1.5" style={glassStyle}>
                      <div className="flex items-start justify-between">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-xs font-semibold text-primary">
                          {staff.user?.username?.slice(0,2).toUpperCase()}
                        </div>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor[status] ?? "bg-gray-100 text-gray-500"}`}>{status}</span>
                      </div>
                      <p className="text-xs font-semibold">{staff.user?.username}</p>
                      {att && (
                        <p className="text-[10px] text-gray-500">
                          {att.clockIn && `In: ${att.clockIn}`}{att.clockIn && att.clockOut && " · "}{att.clockOut && `Out: ${att.clockOut}`}
                          {att.workingHours && ` (${att.workingHours}h)`}
                        </p>
                      )}
                      {att && (
                        <button className="text-[10px] text-blue-600 hover:underline"
                          onClick={() => { setOverrideDialog(att); setOverrideForm({ status: att.status, clockIn: att.clockIn ?? "", clockOut: att.clockOut ?? "", notes: att.notes ?? "" }); }}>
                          Edit
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {attendanceData.length > 0 && (
                <div className="rounded-2xl overflow-hidden" style={glassStyle}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/40">
                          <th className="text-left p-3">Staff</th><th className="text-center p-3">Status</th>
                          <th className="text-center p-3">In</th><th className="text-center p-3">Out</th>
                          <th className="text-center p-3">Hours</th><th className="text-center p-3">Edit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceData.map((a: any) => (
                          <tr key={a.id} className="border-b border-white/30 hover:bg-white/20">
                            <td className="p-3 font-medium">{a.user?.username}</td>
                            <td className="p-3 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColor[a.status] ?? ""}`}>{a.status}</span></td>
                            <td className="p-3 text-center">{a.clockIn || "—"}</td>
                            <td className="p-3 text-center">{a.clockOut || "—"}</td>
                            <td className="p-3 text-center">{a.workingHours ? `${a.workingHours}h` : "—"}</td>
                            <td className="p-3 text-center">
                              <button className="text-blue-600 hover:underline text-[10px]"
                                onClick={() => { setOverrideDialog(a); setOverrideForm({ status: a.status, clockIn: a.clockIn ?? "", clockOut: a.clockOut ?? "", notes: a.notes ?? "" }); }}>
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Override dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={() => setOverrideDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Attendance</DialogTitle><DialogDescription>Admin override for {overrideDialog?.user?.username}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Status</Label>
              <Select value={overrideForm.status} onValueChange={v => setOverrideForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["present","absent","half-day","on-leave","holiday"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Clock In</Label><Input type="time" value={overrideForm.clockIn} onChange={e => setOverrideForm(f => ({ ...f, clockIn: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Clock Out</Label><Input type="time" value={overrideForm.clockOut} onChange={e => setOverrideForm(f => ({ ...f, clockOut: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={overrideForm.notes} onChange={e => setOverrideForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOverrideDialog(null)}>Cancel</Button>
              <Button disabled={overrideMutation.isPending} onClick={() => overrideMutation.mutate({ id: overrideDialog.id, data: overrideForm })}>
                {overrideMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual mark dialog */}
      <Dialog open={manualDialog} onOpenChange={setManualDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark Attendance Manually</DialogTitle><DialogDescription>Record attendance for any staff member</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Staff</Label>
              <Select value={manualForm.userId} onValueChange={v => setManualForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{staffList.map((s: any) => <SelectItem key={s.userId} value={String(s.userId)}>{s.user?.username}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={manualForm.date} onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Status</Label>
              <Select value={manualForm.status} onValueChange={v => setManualForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["present","absent","half-day","on-leave","holiday"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Clock In</Label><Input type="time" value={manualForm.clockIn} onChange={e => setManualForm(f => ({ ...f, clockIn: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Clock Out</Label><Input type="time" value={manualForm.clockOut} onChange={e => setManualForm(f => ({ ...f, clockOut: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={manualForm.notes} onChange={e => setManualForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setManualDialog(false)}>Cancel</Button>
              <Button disabled={manualMutation.isPending || !manualForm.userId}
                onClick={() => manualMutation.mutate({ ...manualForm, userId: parseInt(manualForm.userId) })}>
                {manualMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Mark"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Shifts Tab ────────────────────────────────────────────────────────────────

const shiftColors = ["bg-blue-100 text-blue-800","bg-orange-100 text-orange-800","bg-purple-100 text-purple-800","bg-green-100 text-green-800"];

function ShiftsTab() {
  const { toast } = useToast();
  const [showNewShift, setShowNewShift] = useState(false);
  const [newShift, setNewShift] = useState({ name: "", startTime: "09:00", endTime: "17:00" });
  const [currentWeek, setCurrentWeek] = useState(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
  });

  const { data: shiftDefs = [] } = useQuery<any[]>({ queryKey: ["/api/shifts"] });
  const { data: roster = [] } = useQuery<any[]>({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] });

  const createShiftMutation = useMutation({
    mutationFn: async (data: any) => {
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      const duration = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      return apiRequest("POST", "/api/shifts", { ...data, durationHours: Math.max(0, duration).toFixed(2) });
    },
    onSuccess: () => { toast({ title: "Shift created" }); queryClient.invalidateQueries({ queryKey: ["/api/shifts"] }); setShowNewShift(false); setNewShift({ name: "", startTime: "09:00", endTime: "17:00" }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/shifts/roster", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] }),
    onError: (err: any) => toast({ title: "Failed to assign", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/shifts/roster/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] }),
  });

  const navigateWeek = (delta: number) => {
    const [y, w] = currentWeek.split('-').map(Number);
    let nw = w + delta, ny = y;
    if (nw < 1) { ny--; nw = 52; } else if (nw > 52) { ny++; nw = 1; }
    setCurrentWeek(`${ny}-${String(nw).padStart(2, '0')}`);
  };

  const dates: string[] = roster[0]?.dates ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 space-y-3" style={glassStyle}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Shift Definitions</p>
          <Button size="sm" onClick={() => setShowNewShift(s => !s)}><Plus className="w-3.5 h-3.5 mr-1" />New Shift</Button>
        </div>
        {showNewShift && (
          <div className="flex flex-wrap gap-2 items-end p-3 rounded-xl bg-white/40">
            <div className="space-y-1 flex-1 min-w-[110px]"><Label className="text-xs">Name</Label>
              <Input placeholder="e.g. Morning" value={newShift.name} onChange={e => setNewShift(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" /></div>
            <div className="space-y-1"><Label className="text-xs">Start</Label>
              <Input type="time" value={newShift.startTime} onChange={e => setNewShift(f => ({ ...f, startTime: e.target.value }))} className="h-8 text-xs w-28" /></div>
            <div className="space-y-1"><Label className="text-xs">End</Label>
              <Input type="time" value={newShift.endTime} onChange={e => setNewShift(f => ({ ...f, endTime: e.target.value }))} className="h-8 text-xs w-28" /></div>
            <Button size="sm" className="h-8" disabled={createShiftMutation.isPending} onClick={() => createShiftMutation.mutate(newShift)}>
              {createShiftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowNewShift(false)}>Cancel</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {shiftDefs.map((s: any, i: number) => (
            <span key={s.id} className={`text-xs font-medium px-3 py-1.5 rounded-full ${shiftColors[i % shiftColors.length]}`}>
              {s.name}: {s.startTime}–{s.endTime} ({s.durationHours}h)
            </span>
          ))}
          {shiftDefs.length === 0 && <p className="text-xs text-gray-400">No shifts defined yet. Create one above.</p>}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={glassStyle}>
        <div className="flex items-center justify-between p-4 pb-2">
          <p className="text-sm font-semibold text-gray-700">Weekly Roster</p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => navigateWeek(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-xs font-medium px-2">Week {currentWeek}</span>
            <Button size="sm" variant="ghost" onClick={() => navigateWeek(1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/40">
                <th className="text-left p-3 min-w-[100px]">Staff</th>
                {dates.map((d: string) => (
                  <th key={d} className="text-center p-2 min-w-[90px]">
                    <div className="font-semibold">{new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</div>
                    <div className="text-[10px] text-gray-400">{new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((row: any) => (
                <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                  <td className="p-3">
                    <div className="font-medium">{row.username}</div>
                    <span className={`text-[10px] px-1 rounded ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span>
                  </td>
                  {dates.map((d: string) => {
                    const cell = row.assignments?.[d];
                    const colorIdx = shiftDefs.findIndex((s: any) => s.id === cell?.shift?.id);
                    return (
                      <td key={d} className="p-2 text-center">
                        {cell ? (
                          <div className="space-y-0.5">
                            <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${shiftColors[colorIdx >= 0 ? colorIdx % shiftColors.length : 0]}`}>{cell.shift?.name}</div>
                            <button onClick={() => removeMutation.mutate(cell.assignmentId)} className="text-[9px] text-red-500 hover:underline">remove</button>
                          </div>
                        ) : (
                          <Select onValueChange={sid => assignMutation.mutate({ userId: row.userId, date: d, shiftId: parseInt(sid) })}>
                            <SelectTrigger className="h-6 text-[10px] border-dashed border-gray-300"><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {shiftDefs.map((s: any) => <SelectItem key={s.id} value={String(s.id)} className="text-xs">{s.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {roster.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-xs text-gray-400">No staff found</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Leaves Tab ────────────────────────────────────────────────────────────────

function LeavesTab() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState("pending");
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showApply, setShowApply] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" });
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });
  const leavesKey = `/api/leaves?status=${filterStatus}&month=${filterMonth}`;
  const { data: leavesData = [], isLoading } = useQuery<any[]>({ queryKey: [leavesKey] });

  const leaveTypeColors: Record<string, string> = {
    sick: "bg-red-100 text-red-700", casual: "bg-blue-100 text-blue-700",
    earned: "bg-green-100 text-green-700", unpaid: "bg-gray-100 text-gray-700",
  };
  const leaveStatusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700", approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const start = new Date(data.startDate), end = new Date(data.endDate);
      const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      return apiRequest("POST", "/api/leaves", { ...data, userId: parseInt(data.userId), totalDays });
    },
    onSuccess: () => { toast({ title: "Leave submitted" }); queryClient.invalidateQueries({ queryKey: [leavesKey] }); setShowApply(false); setLeaveForm({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/leaves/${id}`, { status, notes: reviewNotes[id] ?? "" }),
    onSuccess: () => { toast({ title: "Leave updated" }); queryClient.invalidateQueries({ queryKey: [leavesKey] }); },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/60" style={{ background: "rgba(255,255,255,0.4)" }}>
          {["pending","approved","rejected",""].map(s => (
            <button key={s || "all"} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${filterStatus === s ? "bg-white/80 shadow-sm text-gray-900" : "text-gray-600"}`}>
              {s || "All"}
            </button>
          ))}
        </div>
        <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        <Button size="sm" className="ml-auto" onClick={() => setShowApply(true)}><Plus className="w-3.5 h-3.5 mr-1" />Apply Leave</Button>
      </div>

      <Dialog open={showApply} onOpenChange={setShowApply}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apply Leave</DialogTitle><DialogDescription>Submit a leave request</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Staff</Label>
              <Select value={leaveForm.userId} onValueChange={v => setLeaveForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{staffList.map((s: any) => <SelectItem key={s.userId} value={String(s.userId)}>{s.user?.username}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Type</Label>
              <Select value={leaveForm.leaveType} onValueChange={v => setLeaveForm(f => ({ ...f, leaveType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["sick","casual","earned","unpaid"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>From</Label><Input type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>To</Label><Input type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label>Reason</Label><Textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowApply(false)}>Cancel</Button>
              <Button disabled={createMutation.isPending || !leaveForm.userId || !leaveForm.startDate || !leaveForm.endDate}
                onClick={() => createMutation.mutate(leaveForm)}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-24 rounded-xl bg-white/40" />)}</div>
      ) : leavesData.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-400">No leave requests found</p>
      ) : (
        <div className="space-y-2">
          {leavesData.map((leaf: any) => (
            <div key={leaf.id} className="rounded-xl p-4 space-y-2" style={glassStyle}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{leaf.user?.username}</p>
                  <p className="text-xs text-gray-500">{leaf.startDate} to {leaf.endDate} ({leaf.totalDays} day{leaf.totalDays !== 1 ? "s" : ""})</p>
                  {leaf.reason && <p className="text-xs text-gray-600 mt-1 italic truncate">"{leaf.reason}"</p>}
                </div>
                <div className="flex flex-col gap-1 items-end shrink-0">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${leaveTypeColors[leaf.leaveType] ?? ""}`}>{leaf.leaveType}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${leaveStatusColors[leaf.status] ?? ""}`}>{leaf.status}</span>
                </div>
              </div>
              {leaf.status === "pending" && (
                <div className="flex items-center gap-2 pt-1">
                  <Input placeholder="Notes (optional)" value={reviewNotes[leaf.id] ?? ""} className="h-7 text-xs flex-1"
                    onChange={e => setReviewNotes(n => ({ ...n, [leaf.id]: e.target.value }))} />
                  <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                    onClick={() => reviewMutation.mutate({ id: leaf.id, status: "approved" })}>
                    <CheckCircle2 className="w-3 h-3" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 gap-1"
                    onClick={() => reviewMutation.mutate({ id: leaf.id, status: "rejected" })}>
                    <XCircle className="w-3 h-3" />Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Payroll Tab ───────────────────────────────────────────────────────────────

function StaffProfileRow({ staff }: { staff: any }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ biometricId: staff.biometricId ?? "", department: staff.department ?? "", designation: staff.designation ?? "" });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/staff/${staff.userId}/profile`, form);
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      toast({ title: "Saved" });
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-white/30">
      <span className="text-xs font-medium w-24 shrink-0">{staff.user?.username}</span>
      <Input placeholder="Biometric ID" value={form.biometricId} className="h-7 text-xs w-24" onChange={e => setForm(f => ({ ...f, biometricId: e.target.value }))} />
      <Input placeholder="Department" value={form.department} className="h-7 text-xs w-28" onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
      <Input placeholder="Designation" value={form.designation} className="h-7 text-xs w-28" onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
      <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={save}>{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}</Button>
    </div>
  );
}

function PayrollTab() {
  const { toast } = useToast();
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [editingSalary, setEditingSalary] = useState<{ userId: number; salary: string } | null>(null);

  const { data: payrollData = [], isLoading } = useQuery<any[]>({ queryKey: [`/api/payroll/report/${selectedMonth}`] });
  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });

  const updateSalaryMutation = useMutation({
    mutationFn: async ({ userId, salary }: { userId: number; salary: string }) =>
      apiRequest("PUT", `/api/staff/${userId}/profile`, { monthlySalary: salary }),
    onSuccess: () => {
      toast({ title: "Salary updated" });
      queryClient.invalidateQueries({ queryKey: [`/api/payroll/report/${selectedMonth}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
      setEditingSalary(null);
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const totalNet = payrollData.reduce((s: number, r: any) => s + (r.netSalary ?? 0), 0);
  const totalSalary = payrollData.reduce((s: number, r: any) => s + (r.monthlySalary ?? 0), 0);
  const totalDeductions = payrollData.reduce((s: number, r: any) => s + (r.deductions ?? 0), 0);

  const handlePrint = () => {
    const rows = payrollData.map((r: any) =>
      `<tr><td>${r.username}</td><td>${r.role}</td><td>Rs.${Number(r.monthlySalary).toLocaleString('en-IN')}</td><td>${r.workingDays}</td><td>${r.daysPresent}</td><td>${r.absentDays}</td><td>${r.approvedLeaves}</td><td>Rs.${r.deductions.toFixed(2)}</td><td>Rs.${r.overtimePay.toFixed(2)}</td><td><strong>Rs.${r.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td></tr>`
    ).join('');
    const html = `<!DOCTYPE html><html><head><title>Payroll ${selectedMonth}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h2{margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0;font-weight:600}tfoot td{font-weight:bold;background:#f8f8f8}</style></head><body><h2>Payroll Report - ${selectedMonth}</h2><table><thead><tr><th>Staff</th><th>Role</th><th>Salary</th><th>Working Days</th><th>Present</th><th>Absent</th><th>Leave</th><th>Deductions</th><th>OT Pay</th><th>Net Pay</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="9">Total Net Payable</td><td>Rs.${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td></tr></tfoot></table></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) { w.addEventListener('load', () => { w.print(); URL.revokeObjectURL(url); }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-0.5">
          <Label className="text-xs">Month</Label>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="block text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        </div>
        <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={handlePrint}><FileText className="w-3.5 h-3.5" />Print Register</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Staff", value: payrollData.length, color: "text-gray-800" },
          { label: "Total Salary", value: `Rs.${totalSalary.toLocaleString('en-IN')}`, color: "text-blue-700" },
          { label: "Deductions", value: `Rs.${totalDeductions.toFixed(0)}`, color: "text-red-600" },
          { label: "Net Payable", value: `Rs.${totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: "text-green-700" },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-3 text-center" style={glassStyle}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? <div className="h-40 rounded-2xl bg-white/40" /> : (
        <div className="rounded-2xl overflow-hidden" style={glassStyle}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/40">
                  <th className="text-left p-3">Staff</th>
                  <th className="text-center p-3">Salary<br/><span className="text-[10px] font-normal text-gray-400">(click to edit)</span></th>
                  <th className="text-center p-3">Working<br/>Days</th>
                  <th className="text-center p-3">Present</th>
                  <th className="text-center p-3">Absent</th>
                  <th className="text-center p-3">Leave</th>
                  <th className="text-center p-3">Deductions</th>
                  <th className="text-center p-3">OT Pay</th>
                  <th className="text-right p-3 font-semibold">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {payrollData.map((row: any) => (
                  <tr key={row.userId} className="border-b border-white/30 hover:bg-white/20">
                    <td className="p-3">
                      <div className="font-medium">{row.username}</div>
                      <span className={`text-[10px] px-1 rounded ${roleColors[row.role] || roleColors.staff}`}>{row.role}</span>
                    </td>
                    <td className="p-3 text-center">
                      {editingSalary?.userId === row.userId ? (
                        <div className="flex items-center gap-1 justify-center">
                          <Input type="number" value={editingSalary!.salary} className="h-6 w-24 text-xs text-center"
                            onChange={e => setEditingSalary(s => s ? { ...s, salary: e.target.value } : null)} />
                          <Button size="sm" className="h-6 text-[10px] px-2" disabled={updateSalaryMutation.isPending}
                            onClick={() => updateSalaryMutation.mutate({ userId: row.userId, salary: editingSalary!.salary })}>
                            {updateSalaryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => setEditingSalary(null)}>X</Button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingSalary({ userId: row.userId, salary: String(row.monthlySalary) })}
                          className="text-blue-700 hover:underline font-medium">
                          Rs.{Number(row.monthlySalary).toLocaleString('en-IN')}
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-center">{row.workingDays}</td>
                    <td className="p-3 text-center text-green-700 font-medium">{row.daysPresent}</td>
                    <td className="p-3 text-center text-red-600">{row.absentDays}</td>
                    <td className="p-3 text-center text-blue-600">{row.approvedLeaves}</td>
                    <td className="p-3 text-center text-red-600">-Rs.{row.deductions.toFixed(2)}</td>
                    <td className="p-3 text-center text-green-600">+Rs.{row.overtimePay.toFixed(2)}</td>
                    <td className="p-3 text-right font-bold text-green-700">Rs.{row.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/60 bg-white/20">
                  <td className="p-3 font-semibold text-sm" colSpan={8}>Total Net Payable</td>
                  <td className="p-3 text-right font-bold text-lg text-green-700">Rs.{totalNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-4 space-y-3" style={glassStyle}>
        <p className="text-sm font-semibold text-gray-700">Staff Profiles &amp; Biometric ID Setup</p>
        <p className="text-xs text-gray-500">Set the Biometric ID matching your fingerprint machine's Employee ID column so Excel imports map correctly.</p>
        <div className="space-y-2">
          {staffList.map((staff: any) => <StaffProfileRow key={staff.userId} staff={staff} />)}
        </div>
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

  const { activeRole } = useActiveRoleContext();
  const isAdmin = activeRole === "admin";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" style={{ background: "transparent" }}>
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-1">Manage users, categories, and your account</p>
      </div>

      <Tabs defaultValue={isAdmin ? "users" : "profile"}>
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-8" : "grid-cols-2"} rounded-xl p-1`}
          style={{
            background: "rgba(255,255,255,0.50)",
            backdropFilter: "blur(16px) saturate(1.8)",
            WebkitBackdropFilter: "blur(16px) saturate(1.8)",
            border: "1px solid rgba(255,255,255,0.70)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,0.9) inset",
          }}>
          {isAdmin && <TabsTrigger value="users"><Users className="w-4 h-4 mr-1.5" />Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="roles"><ShieldCheck className="w-4 h-4 mr-1.5" />Roles</TabsTrigger>}
          <TabsTrigger value="profile"><User className="w-4 h-4 mr-1.5" />Profile</TabsTrigger>
          <TabsTrigger value="password"><KeyRound className="w-4 h-4 mr-1.5" />Password</TabsTrigger>
          {isAdmin && <TabsTrigger value="attendance"><Clock className="w-4 h-4 mr-1.5" />Attendance</TabsTrigger>}
          {isAdmin && <TabsTrigger value="shifts"><Calendar className="w-4 h-4 mr-1.5" />Shifts</TabsTrigger>}
          {isAdmin && <TabsTrigger value="leaves"><ClipboardList className="w-4 h-4 mr-1.5" />Leaves</TabsTrigger>}
          {isAdmin && <TabsTrigger value="payroll"><DollarSign className="w-4 h-4 mr-1.5" />Payroll</TabsTrigger>}
        </TabsList>

        {/* Users Tab */}
        {isAdmin && (
          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
        )}

        {/* Roles Tab */}
        {isAdmin && (
          <TabsContent value="roles" className="mt-6">
            <RolesTab />
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
              <User className="w-5 h-5 text-emerald-600" />
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

        {isAdmin && (
          <TabsContent value="attendance" className="mt-6">
            <AttendanceTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="shifts" className="mt-6">
            <ShiftsTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="leaves" className="mt-6">
            <LeavesTab />
          </TabsContent>
        )}
        {isAdmin && (
          <TabsContent value="payroll" className="mt-6">
            <PayrollTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
    </div>
  );
}
