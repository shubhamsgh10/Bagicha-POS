import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, User, KeyRound, Users, Tag, Plus, Trash2, Edit2, Shield,
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

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editRole, setEditRole] = useState("");

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

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) =>
      apiRequest("PUT", `/api/users/${id}`, { role }),
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingUser(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update role", description: parseError(err), variant: "destructive" });
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
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {users?.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg bg-card">
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
                {u.id !== currentUser?.id && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditingUser(u); setEditRole(u.role); }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
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
                  </>
                )}
                {u.id === currentUser?.id && (
                  <Badge variant="outline" className="text-xs">You</Badge>
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
            <DialogDescription>Create a new user account with a specific role</DialogDescription>
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
              <Label>Role</Label>
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

      {/* Edit Role Dialog */}
      <Dialog open={!!editingUser} onOpenChange={() => setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role for {editingUser?.username}</DialogTitle>
            <DialogDescription>Select a new role for this user</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={editRole} onValueChange={setEditRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => (
                  <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>admin</strong> – Full access to all features</p>
              <p><strong>manager</strong> – Menu, orders, inventory, reports</p>
              <p><strong>cashier</strong> – POS, orders, billing</p>
              <p><strong>kitchen</strong> – KOT view only</p>
              <p><strong>staff</strong> – Basic access</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
              <Button
                disabled={updateRoleMutation.isPending}
                onClick={() => updateRoleMutation.mutate({ id: editingUser.id, role: editRole })}
              >
                {updateRoleMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Role"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Categories Tab ─────────────────────────────────────────────────────────────

function CategoriesTab() {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const { data: categories, isLoading } = useQuery<any[]>({ queryKey: ["/api/categories"] });

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/categories", { name: newName.trim(), description: newDesc.trim() || null }),
    onSuccess: () => {
      toast({ title: "Category created" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setNewName("");
      setNewDesc("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to create category", description: parseError(err), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, description }: { id: number; name: string; description: string }) =>
      apiRequest("PUT", `/api/categories/${id}`, { name, description: description || null }),
    onSuccess: () => {
      toast({ title: "Category updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update category", description: parseError(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/categories/${id}`),
    onSuccess: () => {
      toast({ title: "Category deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete category", description: parseError(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      {/* Add Category */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Add New Category</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Category Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Pizza, Drinks, Desserts"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description"
                className="h-8"
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Adding...</> : <><Plus className="w-3 h-3 mr-1" /> Add Category</>}
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {categories?.map((cat: any) => (
            <div key={cat.id} className="border rounded-lg p-3 bg-card">
              {editingId === cat.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 text-sm"
                    />
                    <Input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description"
                      className="h-7 text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={() => updateMutation.mutate({ id: cat.id, name: editName, description: editDesc })} disabled={!editName.trim() || updateMutation.isPending}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{cat.name}</p>
                    {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => { setEditingId(cat.id); setEditName(cat.name); setEditDesc(cat.description || ""); }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete category "${cat.name}"? This will hide it from the menu.`)) {
                          deleteMutation.mutate(cat.id);
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {categories?.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
          )}
        </div>
      )}
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

  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage users, categories, and your account</p>
      </div>

      <Tabs defaultValue={isAdmin ? "users" : "profile"}>
        <TabsList className={`grid w-full ${isAdmin ? "grid-cols-4" : "grid-cols-2"}`}>
          {isAdmin && <TabsTrigger value="users"><Users className="w-4 h-4 mr-1.5" />Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="categories"><Tag className="w-4 h-4 mr-1.5" />Categories</TabsTrigger>}
          <TabsTrigger value="profile"><User className="w-4 h-4 mr-1.5" />Profile</TabsTrigger>
          <TabsTrigger value="password"><KeyRound className="w-4 h-4 mr-1.5" />Password</TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        {isAdmin && (
          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
        )}

        {/* Categories Tab */}
        {isAdmin && (
          <TabsContent value="categories" className="mt-6">
            <CategoriesTab />
          </TabsContent>
        )}

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Change Username</CardTitle>
              </div>
              <CardDescription>Update the username used to sign in</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={usernameForm.handleSubmit(onUsernameSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label>New Username</Label>
                  <Input placeholder="Enter new username" {...usernameForm.register("username")} />
                  {usernameForm.formState.errors.username && (
                    <p className="text-xs text-destructive">{usernameForm.formState.errors.username.message}</p>
                  )}
                </div>
                <Button type="submit" disabled={usernameLoading}>
                  {usernameLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Username"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Password Tab */}
        <TabsContent value="password" className="mt-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Change Password</CardTitle>
              </div>
              <CardDescription>Choose a strong password with at least 6 characters</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label>Current Password</Label>
                  <Input type="password" placeholder="••••••••" autoComplete="current-password" {...passwordForm.register("currentPassword")} />
                  {passwordForm.formState.errors.currentPassword && (
                    <p className="text-xs text-destructive">{passwordForm.formState.errors.currentPassword.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <Input type="password" placeholder="••••••••" autoComplete="new-password" {...passwordForm.register("newPassword")} />
                  {passwordForm.formState.errors.newPassword && (
                    <p className="text-xs text-destructive">{passwordForm.formState.errors.newPassword.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Confirm New Password</Label>
                  <Input type="password" placeholder="••••••••" autoComplete="new-password" {...passwordForm.register("confirmPassword")} />
                  {passwordForm.formState.errors.confirmPassword && (
                    <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>
                <Button type="submit" disabled={passwordLoading}>
                  {passwordLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Changing...</> : "Change Password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </div>
  );
}
