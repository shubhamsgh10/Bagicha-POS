import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
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
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-white/40 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {users?.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between p-3 rounded-xl backdrop-blur-sm bg-white/50 border border-white/40 shadow-sm">
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
    if (newPin.length !== 4) { setPinDialogError("PIN must be exactly 4 digits"); return; }
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
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Assign roles and manage POS PINs for each user</p>
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
      </div>

      {/* Role legend */}
      <div className="rounded-2xl backdrop-blur-sm bg-white/40 border border-white/30 shadow-sm">
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
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white/40 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No users found. Make sure you are logged in as admin.</p>
        )}
        <div className="space-y-2">
          {users.map((u: any) => (
            <div key={u.id} className="rounded-xl backdrop-blur-sm bg-white/50 border border-white/40 shadow-sm p-4 space-y-3">
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
                {u.id === currentUser?.id && <Badge variant="outline" className="text-xs">You</Badge>}
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
                : `${pinDialogUser?.pin ? "Change" : "Set a"} 4-digit PIN for "${pinDialogUser?.username}".`}
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
                <Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="4 digits"
                  value={newPin} onChange={(e) => { setNewPin(e.target.value.replace(/\D/g, "")); setPinDialogError(""); }} />
              </div>
              <div className="space-y-2">
                <Label>Confirm PIN</Label>
                <Input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="Re-enter PIN"
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
    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-1">Manage users, categories, and your account</p>
      </div>

      <Tabs defaultValue={isAdmin ? "users" : "profile"}>
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-4" : "grid-cols-2"} rounded-xl bg-white/40 backdrop-blur-sm border border-white/30 p-1`}>
          {isAdmin && <TabsTrigger value="users"><Users className="w-4 h-4 mr-1.5" />Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="roles"><ShieldCheck className="w-4 h-4 mr-1.5" />Roles</TabsTrigger>}
          <TabsTrigger value="profile"><User className="w-4 h-4 mr-1.5" />Profile</TabsTrigger>
          <TabsTrigger value="password"><KeyRound className="w-4 h-4 mr-1.5" />Password</TabsTrigger>
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
          <div className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5">
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
          <div className="rounded-2xl backdrop-blur-lg bg-white/40 border border-white/30 shadow-md p-5">
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
