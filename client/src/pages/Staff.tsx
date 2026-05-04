import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Header } from "@/components/Header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Users, RefreshCw, Settings2, Clock, TrendingUp,
  CheckCircle2, XCircle, AlertCircle, Loader2, Link2,
  CalendarDays, IndianRupee, Plus, ChevronLeft, ChevronRight,
  FileText, ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── helpers ───────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

function fmtHours(h: number) {
  if (!h) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

const AVATAR_GRADIENTS: [string, string][] = [
  ["#10b981", "#059669"], ["#0ea5e9", "#0284c7"],
  ["#8b5cf6", "#7c3aed"], ["#f59e0b", "#d97706"],
  ["#ef4444", "#dc2626"], ["#ec4899", "#db2777"],
  ["#14b8a6", "#0d9488"], ["#6366f1", "#4f46e5"],
];
function getAvatarColors(name: string): [string, string] {
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}
function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

// ── style constants ───────────────────────────────────────────────────────────

const glass: React.CSSProperties = {
  background: "rgba(255,255,255,0.42)",
  backdropFilter: "blur(24px) saturate(1.8)",
  WebkitBackdropFilter: "blur(24px) saturate(1.8)",
  border: "1px solid rgba(255,255,255,0.60)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 1px 0 rgba(255,255,255,0.80) inset",
};

const glassCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(16px) saturate(1.8)",
  WebkitBackdropFilter: "blur(16px) saturate(1.8)",
  border: "1px solid rgba(255,255,255,0.72)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.055), 0 1px 0 rgba(255,255,255,0.95) inset",
};

const statusMeta: Record<string, { bg: string; text: string; dot: string }> = {
  present:   { bg: "rgba(16,185,129,0.12)", text: "#065f46", dot: "#10b981" },
  absent:    { bg: "rgba(239,68,68,0.12)",  text: "#991b1b", dot: "#ef4444" },
  late:      { bg: "rgba(245,158,11,0.14)", text: "#92400e", dot: "#f59e0b" },
  "half-day":{ bg: "rgba(59,130,246,0.12)", text: "#1e40af", dot: "#3b82f6" },
};

const roleColors: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  manager: "bg-blue-100 text-blue-800",
  staff: "bg-gray-100 text-gray-700",
};

const shiftColors = ["bg-blue-100 text-blue-800","bg-orange-100 text-orange-800","bg-purple-100 text-purple-800","bg-green-100 text-green-800"];

const leaveTypeColors: Record<string, string> = {
  sick: "bg-red-100 text-red-700", casual: "bg-blue-100 text-blue-700",
  earned: "bg-green-100 text-green-700", unpaid: "bg-gray-100 text-gray-700",
};
const leaveStatusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700", approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
};

// ── types ─────────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  id: number; employeeName: string; employeeCode: string | null;
  date: string; punchIn: string | null; punchOut: string | null;
  hoursWorked: string | null; status: string; source: string; syncedAt: string;
}
interface AttendanceSummary { name: string; present: number; absent: number; late: number; halfDay: number; totalHours: number; }
interface StaffPerformance { staffId: number | null; staffName: string; totalOrders: number; totalRevenue: number; avgBill: number; }
interface AttendanceSettings { sheetUrl: string; columnMapping: Record<string, string> | null; autoSyncHour: number; }
interface SheetPreview { headers: string[]; rows: Array<Record<string, string>>; error?: string; }

// ── Shifts sub-component ──────────────────────────────────────────────────────

function ShiftsPanel() {
  const { toast } = useToast();
  const [showNewShift, setShowNewShift] = useState(false);
  const [newShift, setNewShift] = useState({ name: "", startTime: "09:00", endTime: "17:00" });
  const [currentWeek, setCurrentWeek] = useState(() => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-${String(weekNum).padStart(2, "0")}`;
  });

  const { data: shiftDefs = [] } = useQuery<any[]>({ queryKey: ["/api/shifts"] });
  const { data: roster = [] } = useQuery<any[]>({ queryKey: [`/api/shifts/roster?week=${currentWeek}`] });

  const createShiftMutation = useMutation({
    mutationFn: async (data: any) => {
      const [sh, sm] = data.startTime.split(":").map(Number);
      const [eh, em] = data.endTime.split(":").map(Number);
      const duration = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      return apiRequest("POST", "/api/shifts", { ...data, durationHours: Math.max(0, duration).toFixed(2) });
    },
    onSuccess: () => {
      toast({ title: "Shift created" });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setShowNewShift(false);
      setNewShift({ name: "", startTime: "09:00", endTime: "17:00" });
    },
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
    const [y, w] = currentWeek.split("-").map(Number);
    let nw = w + delta, ny = y;
    if (nw < 1) { ny--; nw = 52; } else if (nw > 52) { ny++; nw = 1; }
    setCurrentWeek(`${ny}-${String(nw).padStart(2, "0")}`);
  };

  const dates: string[] = roster[0]?.dates ?? [];

  return (
    <div className="space-y-4">
      {/* Shift definitions */}
      <div className="rounded-2xl p-4 space-y-3" style={glassCard}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">Shift Definitions</p>
          <Button size="sm" onClick={() => setShowNewShift(s => !s)}>
            <Plus className="w-3.5 h-3.5 mr-1" />New Shift
          </Button>
        </div>
        {showNewShift && (
          <div className="flex flex-wrap gap-2 items-end p-3 rounded-xl bg-white/40">
            <div className="space-y-1 flex-1 min-w-[110px]">
              <Label className="text-xs">Name</Label>
              <Input placeholder="e.g. Morning" value={newShift.name} onChange={e => setNewShift(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start</Label>
              <Input type="time" value={newShift.startTime} onChange={e => setNewShift(f => ({ ...f, startTime: e.target.value }))} className="h-8 text-xs w-28" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End</Label>
              <Input type="time" value={newShift.endTime} onChange={e => setNewShift(f => ({ ...f, endTime: e.target.value }))} className="h-8 text-xs w-28" />
            </div>
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

      {/* Weekly roster */}
      <div className="rounded-2xl overflow-hidden" style={glassCard}>
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
                    <div className="font-semibold">{new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</div>
                    <div className="text-[10px] text-gray-400">{new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
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

// ── Leaves sub-component ──────────────────────────────────────────────────────

function LeavesPanel() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState("pending");
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showApply, setShowApply] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" });
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const { data: staffList = [] } = useQuery<any[]>({ queryKey: ["/api/staff"] });
  const leavesKey = `/api/leaves?status=${filterStatus}&month=${filterMonth}`;
  const { data: leavesData = [], isLoading } = useQuery<any[]>({ queryKey: [leavesKey] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const start = new Date(data.startDate), end = new Date(data.endDate);
      const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
      return apiRequest("POST", "/api/leaves", { ...data, userId: parseInt(data.userId), totalDays });
    },
    onSuccess: () => {
      toast({ title: "Leave submitted" });
      queryClient.invalidateQueries({ queryKey: [leavesKey] });
      setShowApply(false);
      setLeaveForm({ userId: "", leaveType: "casual", startDate: "", endDate: "", reason: "" });
    },
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
        <Button size="sm" className="ml-auto" onClick={() => setShowApply(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" />Apply Leave
        </Button>
      </div>

      <Dialog open={showApply} onOpenChange={setShowApply}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Apply Leave</DialogTitle><DialogDescription>Submit a leave request</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Staff</Label>
              <Select value={leaveForm.userId} onValueChange={v => setLeaveForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{staffList.map((s: any) => <SelectItem key={s.userId} value={String(s.userId)}>{s.user?.username}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
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
            <div key={leaf.id} className="rounded-xl p-4 space-y-2" style={glassCard}>
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

// ── Payroll sub-component ─────────────────────────────────────────────────────

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

function PayrollPanel() {
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
      `<tr><td>${r.username}</td><td>${r.role}</td><td>Rs.${Number(r.monthlySalary).toLocaleString("en-IN")}</td><td>${r.workingDays}</td><td>${r.daysPresent}</td><td>${r.absentDays}</td><td>${r.approvedLeaves}</td><td>Rs.${r.deductions.toFixed(2)}</td><td>Rs.${r.overtimePay.toFixed(2)}</td><td><strong>Rs.${r.netSalary.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><title>Payroll ${selectedMonth}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h2{margin-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f0f0f0;font-weight:600}tfoot td{font-weight:bold;background:#f8f8f8}</style></head><body><h2>Payroll Report - ${selectedMonth}</h2><table><thead><tr><th>Staff</th><th>Role</th><th>Salary</th><th>Working Days</th><th>Present</th><th>Absent</th><th>Leave</th><th>Deductions</th><th>OT Pay</th><th>Net Pay</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="9">Total Net Payable</td><td>Rs.${totalNet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td></tr></tfoot></table></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) { w.addEventListener("load", () => { w.print(); URL.revokeObjectURL(url); }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-0.5">
          <Label className="text-xs">Month</Label>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="block text-xs border rounded-lg px-2 py-1.5 bg-white/60 border-white/60" />
        </div>
        <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={handlePrint}>
          <FileText className="w-3.5 h-3.5" />Print Register
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Staff", value: payrollData.length, color: "text-gray-800" },
          { label: "Total Salary", value: `Rs.${totalSalary.toLocaleString("en-IN")}`, color: "text-blue-700" },
          { label: "Deductions", value: `Rs.${totalDeductions.toFixed(0)}`, color: "text-red-600" },
          { label: "Net Payable", value: `Rs.${totalNet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, color: "text-green-700" },
        ].map(c => (
          <div key={c.label} className="rounded-xl p-3 text-center" style={glassCard}>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {isLoading ? <div className="h-40 rounded-2xl bg-white/40" /> : (
        <div className="rounded-2xl overflow-hidden" style={glassCard}>
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
                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => setEditingSalary(null)}>×</Button>
                        </div>
                      ) : (
                        <button onClick={() => setEditingSalary({ userId: row.userId, salary: String(row.monthlySalary) })}
                          className="text-blue-700 hover:underline font-medium">
                          Rs.{Number(row.monthlySalary).toLocaleString("en-IN")}
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-center">{row.workingDays}</td>
                    <td className="p-3 text-center text-green-700 font-medium">{row.daysPresent}</td>
                    <td className="p-3 text-center text-red-600">{row.absentDays}</td>
                    <td className="p-3 text-center text-blue-600">{row.approvedLeaves}</td>
                    <td className="p-3 text-center text-red-600">-Rs.{row.deductions.toFixed(2)}</td>
                    <td className="p-3 text-center text-green-600">+Rs.{row.overtimePay.toFixed(2)}</td>
                    <td className="p-3 text-right font-bold text-green-700">Rs.{row.netSalary.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/60 bg-white/20">
                  <td className="p-3 font-semibold text-sm" colSpan={8}>Total Net Payable</td>
                  <td className="p-3 text-right font-bold text-lg text-green-700">Rs.{totalNet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-4 space-y-3" style={glassCard}>
        <p className="text-sm font-semibold text-gray-700">Staff Profiles &amp; Biometric ID Setup</p>
        <p className="text-xs text-gray-500">Set the Biometric ID matching your fingerprint machine's Employee ID column so imports map correctly.</p>
        <div className="space-y-2">
          {staffList.map((staff: any) => <StaffProfileRow key={staff.userId} staff={staff} />)}
        </div>
      </div>
    </div>
  );
}

// ── Main Staff Page ───────────────────────────────────────────────────────────

export default function Staff() {
  const { toast } = useToast();

  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate,   setToDate]   = useState(today());
  const [empFilter, setEmpFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"attendance" | "summary" | "shifts" | "leaves" | "payroll" | "performance">("attendance");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetUrl,     setSheetUrl]     = useState("");
  const [autoSyncHour, setAutoSyncHour] = useState("-1");
  const [colMapping, setColMapping] = useState<Record<string, string>>({
    employeeName: "", date: "", punchIn: "", punchOut: "", hoursWorked: "", status: "",
  });

  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: attendanceSettings } = useQuery<AttendanceSettings>({
    queryKey: ["/api/attendance/settings"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/settings", { credentials: "include" });
      if (!res.ok) return { sheetUrl: "", columnMapping: null, autoSyncHour: -1 };
      return res.json();
    },
  });

  useEffect(() => {
    if (!attendanceSettings) return;
    setSheetUrl(attendanceSettings.sheetUrl ?? "");
    setAutoSyncHour(String(attendanceSettings.autoSyncHour ?? -1));
    if (attendanceSettings.columnMapping) {
      setColMapping(prev => ({ ...prev, ...attendanceSettings.columnMapping }));
    }
  }, [attendanceSettings]);

  const { data: employees = [] } = useQuery<string[]>({
    queryKey: ["/api/attendance/employees"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/employees", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: attendance = [], isLoading: attLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance", fromDate, toDate, empFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (empFilter !== "all") params.set("employee", empFilter);
      const res = await fetch(`/api/attendance?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: summary = [] } = useQuery<AttendanceSummary[]>({
    queryKey: ["/api/attendance/summary", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/attendance/summary?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: performance = [] } = useQuery<StaffPerformance[]>({
    queryKey: ["/api/staff/performance", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/staff/performance?${params}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: syncLog = [] } = useQuery<any[]>({
    queryKey: ["/api/attendance/sync-log"],
    queryFn: async () => {
      const res = await fetch("/api/attendance/sync-log", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // ── mutations ────────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance/sync").then(r => r.json()),
    onSuccess: (data) => {
      if (data.status === "failed") {
        toast({ title: "Sync failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Sync complete", description: `${data.rowsInserted} new records added, ${data.rowsSkipped} updated.` });
        queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
        queryClient.invalidateQueries({ queryKey: ["/api/attendance/sync-log"] });
        queryClient.invalidateQueries({ queryKey: ["/api/attendance/employees"] });
        queryClient.invalidateQueries({ queryKey: ["/api/attendance/summary"] });
      }
    },
    onError: () => toast({ title: "Sync error", variant: "destructive" }),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/attendance/settings", {
      sheetUrl, columnMapping: colMapping, autoSyncHour: parseInt(autoSyncHour),
    }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setSettingsOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/attendance/settings"] });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  async function handlePreview() {
    if (!sheetUrl) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await apiRequest("POST", "/api/attendance/preview", { sheetUrl });
      setPreview(await res.json());
    } catch {
      setPreview({ headers: [], rows: [], error: "Failed to fetch sheet." });
    } finally {
      setPreviewLoading(false);
    }
  }

  // ── derived ───────────────────────────────────────────────────────────────────

  const hasSheet = !!attendanceSettings?.sheetUrl;
  const lastSync = syncLog[0];
  const totalPresent = summary.reduce((s, e) => s + e.present, 0);
  const totalAbsent  = summary.reduce((s, e) => s + e.absent, 0);
  const totalHours   = summary.reduce((s, e) => s + e.totalHours, 0);
  const maxRevenue   = performance.length > 0 ? performance[0].totalRevenue : 1;

  const TABS = [
    { id: "attendance",  label: "Attendance", icon: CalendarDays },
    { id: "summary",     label: "Summary",    icon: Users        },
    { id: "shifts",      label: "Shifts",     icon: Clock        },
    { id: "leaves",      label: "Leaves",     icon: ClipboardList},
    { id: "payroll",     label: "Payroll",    icon: IndianRupee  },
    { id: "performance", label: "Sales",      icon: TrendingUp   },
  ] as const;

  const RANK_COLORS = [
    { bg: "linear-gradient(135deg,#f59e0b,#d97706)", shadow: "rgba(245,158,11,0.35)" },
    { bg: "linear-gradient(135deg,#94a3b8,#64748b)", shadow: "rgba(148,163,184,0.35)" },
    { bg: "linear-gradient(135deg,#cd7c2c,#a16207)", shadow: "rgba(205,124,44,0.35)" },
  ];

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Staff"
        description="Attendance, shifts, leaves & payroll"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              style={{ ...glass, borderRadius: "10px", padding: "6px 14px", fontSize: "13px", fontWeight: 600, color: "#374151", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Settings2 size={14} />Configure Sheet
            </button>
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !hasSheet}
              style={{
                borderRadius: "10px", padding: "6px 14px", fontSize: "13px", fontWeight: 600, color: "white",
                background: hasSheet ? "linear-gradient(135deg,#10b981,#059669)" : "#d1d5db",
                border: "none", cursor: hasSheet ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", gap: "6px",
                boxShadow: hasSheet ? "0 4px 14px rgba(16,185,129,0.35)" : "none",
              }}
            >
              {syncMutation.isPending
                ? <><Loader2 size={14} className="animate-spin" />Syncing…</>
                : <><RefreshCw size={14} />Sync Now</>}
            </button>
          </div>
        }
      />

      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 space-y-5">

        {/* No sheet banner */}
        {!hasSheet && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: "linear-gradient(135deg,rgba(245,158,11,0.12),rgba(251,191,36,0.08))", border: "1px solid rgba(245,158,11,0.30)", borderRadius: "16px", padding: "16px 20px", display: "flex", alignItems: "center", gap: "14px" }}
          >
            <div style={{ width: 40, height: 40, borderRadius: "10px", background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Link2 size={18} color="#d97706" />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, color: "#92400e", fontSize: 14 }}>Google Sheet not connected</p>
              <p style={{ fontSize: 12, color: "#a16207", marginTop: 2 }}>Click <strong>Configure Sheet</strong> to paste your biometric export URL and map columns.</p>
            </div>
            <button onClick={() => setSettingsOpen(true)} style={{ background: "#d97706", color: "white", border: "none", borderRadius: "8px", padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Configure
            </button>
          </motion.div>
        )}

        {/* Last sync chip */}
        {lastSync && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280" }}>
            <Clock size={12} />
            Last sync: {new Date(lastSync.syncedAt).toLocaleString()} —&nbsp;
            {lastSync.status === "success"
              ? <span style={{ color: "#059669" }}>{lastSync.rowsInserted} added, {lastSync.rowsSkipped} updated</span>
              : <span style={{ color: "#dc2626" }}>failed — {lastSync.error}</span>}
          </div>
        )}

        {/* Stat strip — shown only on attendance/summary */}
        {summary.length > 0 && (activeTab === "attendance" || activeTab === "summary") && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}
          >
            {[
              { label: "Employees",    value: summary.length,       icon: Users,         color: "#6366f1", bg: "rgba(99,102,241,0.10)" },
              { label: "Present Days", value: totalPresent,         icon: CheckCircle2,  color: "#10b981", bg: "rgba(16,185,129,0.10)" },
              { label: "Absent Days",  value: totalAbsent,          icon: XCircle,       color: "#ef4444", bg: "rgba(239,68,68,0.10)"  },
              { label: "Total Hours",  value: fmtHours(totalHours), icon: Clock,         color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
            ].map((stat, i) => (
              <motion.div key={stat.label} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.06, type: "spring", stiffness: 260, damping: 22 }}
                style={{ ...glass, borderRadius: 14, padding: "14px 16px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: stat.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <stat.icon size={16} color={stat.color} />
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>{stat.label}</p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>{stat.value}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Date/employee filters — shown only for attendance/summary tabs */}
        {(activeTab === "attendance" || activeTab === "summary") && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
            style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}
          >
            {[
              { label: "From", value: fromDate, onChange: setFromDate },
              { label: "To",   value: toDate,   onChange: setToDate   },
            ].map(({ label, value, onChange }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.04em" }}>{label.toUpperCase()}</label>
                <input type="date" value={value} onChange={e => onChange(e.target.value)}
                  style={{ ...glass, borderRadius: 10, padding: "6px 10px", fontSize: 13, color: "#111827", outline: "none", height: 34, width: 148 }} />
              </div>
            ))}
            {activeTab === "attendance" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.04em" }}>EMPLOYEE</label>
                <div style={{ ...glass, borderRadius: 10, height: 34, display: "flex", alignItems: "center" }}>
                  <Select value={empFilter} onValueChange={setEmpFilter}>
                    <SelectTrigger className="h-8 text-sm w-44 border-0 bg-transparent shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {employees.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Tab bar */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}>
          <div style={{ display: "inline-flex", gap: 4, background: "rgba(0,0,0,0.05)", borderRadius: 14, padding: 4 }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 16px", borderRadius: 10, border: "none",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.18s ease",
                  ...(activeTab === tab.id
                    ? { background: "rgba(255,255,255,0.85)", color: "#10b981", boxShadow: "0 2px 8px rgba(0,0,0,0.10)" }
                    : { background: "transparent", color: "#6b7280" }),
                }}
              >
                <tab.icon size={13} />
                {tab.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Tab content */}
        <AnimatePresence mode="wait">

          {/* ── Attendance ── */}
          {activeTab === "attendance" && (
            <motion.div key="attendance" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {attLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                  <Loader2 size={24} className="animate-spin" color="#10b981" />
                </div>
              ) : attendance.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                  <CalendarDays size={40} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>No attendance records for this period.</p>
                  {hasSheet && <p style={{ fontSize: 12, marginTop: 4 }}>Click <strong>Sync Now</strong> to import from Google Sheets.</p>}
                </div>
              ) : (
                <div style={{ ...glass, borderRadius: 16, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", padding: "10px 20px", background: "rgba(16,185,129,0.06)", borderBottom: "1px solid rgba(0,0,0,0.06)", fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <span>Employee</span><span>Date</span><span>Punch In</span><span>Punch Out</span><span>Hours</span><span>Status</span>
                  </div>
                  {attendance.map((rec, i) => {
                    const [c1, c2] = getAvatarColors(rec.employeeName);
                    const sm = statusMeta[rec.status] ?? { bg: "rgba(0,0,0,0.06)", text: "#374151", dot: "#9ca3af" };
                    return (
                      <motion.div key={rec.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.025, 0.4) }}
                        style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: i < attendance.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", alignItems: "center", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.28)" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${c1},${c2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0 }}>
                            {getInitials(rec.employeeName)}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{rec.employeeName}</div>
                            {rec.employeeCode && <div style={{ fontSize: 10, color: "#9ca3af" }}>{rec.employeeCode}</div>}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: "#374151" }}>{rec.date}</span>
                        <span style={{ fontSize: 12, fontFamily: "monospace", color: "#374151" }}>{rec.punchIn ?? "—"}</span>
                        <span style={{ fontSize: 12, fontFamily: "monospace", color: "#374151" }}>{rec.punchOut ?? "—"}</span>
                        <span style={{ fontSize: 12, color: "#374151" }}>{fmtHours(parseFloat(rec.hoursWorked ?? "0"))}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: sm.bg, color: sm.text, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, textTransform: "capitalize", width: "fit-content" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: sm.dot, flexShrink: 0 }} />{rec.status}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Summary ── */}
          {activeTab === "summary" && (
            <motion.div key="summary" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {summary.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                  <Users size={40} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>No data for this period.</p>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
                  {summary.map((s, i) => {
                    const [c1, c2] = getAvatarColors(s.name);
                    const total = s.present + s.absent + s.late + s.halfDay;
                    const attendancePct = total > 0 ? Math.round((s.present + s.late * 0.5 + s.halfDay * 0.5) / total * 100) : 0;
                    return (
                      <motion.div key={s.name} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 24 }}
                        style={{ ...glass, borderRadius: 18, padding: "18px 20px" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                          <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg,${c1},${c2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "white", boxShadow: `0 4px 12px ${c1}50` }}>
                            {getInitials(s.name)}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{s.name}</p>
                            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>{total} records</p>
                          </div>
                          <div style={{ background: attendancePct >= 80 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.10)", color: attendancePct >= 80 ? "#059669" : "#dc2626", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 700 }}>
                            {attendancePct}%
                          </div>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ height: 6, borderRadius: 3, background: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                            <motion.div initial={{ width: 0 }} animate={{ width: `${attendancePct}%` }} transition={{ delay: i * 0.05 + 0.2, duration: 0.6, ease: "easeOut" }}
                              style={{ height: "100%", background: `linear-gradient(90deg,${c1},${c2})`, borderRadius: 3 }} />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          {[
                            { icon: CheckCircle2, label: "Present", value: s.present,             color: "#10b981" },
                            { icon: XCircle,      label: "Absent",  value: s.absent,              color: "#ef4444" },
                            { icon: AlertCircle,  label: "Late",    value: s.late,                color: "#f59e0b" },
                            { icon: Clock,        label: "Hours",   value: fmtHours(s.totalHours), color: "#6366f1" },
                          ].map(stat => (
                            <div key={stat.label} style={{ background: "rgba(255,255,255,0.45)", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 7 }}>
                              <stat.icon size={13} color={stat.color} />
                              <div>
                                <p style={{ fontSize: 10, color: "#6b7280", fontWeight: 500 }}>{stat.label}</p>
                                <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", lineHeight: 1.1 }}>{stat.value}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Shifts ── */}
          {activeTab === "shifts" && (
            <motion.div key="shifts" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <ShiftsPanel />
            </motion.div>
          )}

          {/* ── Leaves ── */}
          {activeTab === "leaves" && (
            <motion.div key="leaves" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <LeavesPanel />
            </motion.div>
          )}

          {/* ── Payroll ── */}
          {activeTab === "payroll" && (
            <motion.div key="payroll" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <PayrollPanel />
            </motion.div>
          )}

          {/* ── Sales Performance ── */}
          {activeTab === "performance" && (
            <motion.div key="performance" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {performance.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af" }}>
                  <TrendingUp size={40} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>No order data for this period.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Date filter for performance */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 4 }}>
                    {[{ label: "From", value: fromDate, onChange: setFromDate }, { label: "To", value: toDate, onChange: setToDate }].map(({ label, value, onChange }) => (
                      <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.04em" }}>{label.toUpperCase()}</label>
                        <input type="date" value={value} onChange={e => onChange(e.target.value)}
                          style={{ ...glass, borderRadius: 10, padding: "6px 10px", fontSize: 13, color: "#111827", outline: "none", height: 34, width: 148 }} />
                      </div>
                    ))}
                  </div>
                  {performance.map((p, i) => {
                    const [c1, c2] = getAvatarColors(p.staffName);
                    const revPct = maxRevenue > 0 ? (p.totalRevenue / maxRevenue) * 100 : 0;
                    const isTop3 = i < 3;
                    const rank = RANK_COLORS[i];
                    return (
                      <motion.div key={p.staffId ?? "unassigned"} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, type: "spring", stiffness: 260, damping: 24 }}
                        style={{ ...glass, borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, ...(isTop3 ? { boxShadow: `0 8px 24px ${rank.shadow}, 0 1px 0 rgba(255,255,255,0.80) inset` } : {}) }}
                      >
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: isTop3 ? rank.bg : "rgba(0,0,0,0.07)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTop3 ? 15 : 13, fontWeight: 800, color: isTop3 ? "white" : "#9ca3af", flexShrink: 0, boxShadow: isTop3 ? `0 4px 10px ${rank.shadow}` : "none" }}>
                          {isTop3 ? ["🥇","🥈","🥉"][i] : i + 1}
                        </div>
                        <div style={{ width: 38, height: 38, borderRadius: 12, background: `linear-gradient(135deg,${c1},${c2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "white", flexShrink: 0, boxShadow: `0 3px 10px ${c1}50` }}>
                          {getInitials(p.staffName)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{p.staffName}</p>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(0,0,0,0.08)", overflow: "hidden" }}>
                              <motion.div initial={{ width: 0 }} animate={{ width: `${revPct}%` }} transition={{ delay: i * 0.05 + 0.2, duration: 0.7, ease: "easeOut" }}
                                style={{ height: "100%", background: `linear-gradient(90deg,${c1},${c2})`, borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 10, color: "#9ca3af", whiteSpace: "nowrap" }}>{p.totalOrders} orders</span>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
                            <IndianRupee size={12} color="#10b981" />
                            <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>{p.totalRevenue.toLocaleString("en-IN")}</span>
                          </div>
                          <p style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }}>avg ₹{Math.round(p.avgBill).toLocaleString("en-IN")}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ── Sheet Settings Dialog ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attendance Sheet Settings</DialogTitle>
            <DialogDescription>Connect your biometric export Google Sheet. Share the sheet as "Anyone with link can view" first.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Google Sheet URL</label>
              <div className="flex gap-2">
                <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 h-9 rounded-lg border border-gray-200 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                <button onClick={handlePreview} disabled={!sheetUrl || previewLoading}
                  className="px-3 h-9 rounded-lg border border-gray-200 text-sm font-medium disabled:opacity-40 hover:bg-gray-50 transition-colors">
                  {previewLoading ? <Loader2 size={14} className="animate-spin" /> : "Preview"}
                </button>
              </div>
            </div>
            {preview && (
              <div className="rounded-lg border p-3 space-y-2">
                {preview.error ? <p className="text-sm text-red-600">{preview.error}</p> : (
                  <>
                    <p className="text-xs font-medium text-gray-500">Found {preview.headers.length} columns. Map them below:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.headers.map(h => <span key={h} className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono">{h}</span>)}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-700">Column Mapping</label>
              <p className="text-xs text-gray-500">Type the exact column header name from your sheet for each field.</p>
              {([
                ["employeeName", "Employee Name *"],
                ["date",         "Date *"],
                ["punchIn",      "Punch In Time"],
                ["punchOut",     "Punch Out Time"],
                ["hoursWorked",  "Total Hours"],
                ["status",       "Status (Present/Absent)"],
                ["employeeCode", "Employee Code / ID"],
              ] as const).map(([field, label]) => (
                <div key={field} className="flex items-center gap-3">
                  <span className="text-xs w-44 shrink-0 text-gray-500">{label}</span>
                  <input value={colMapping[field] ?? ""} onChange={e => setColMapping(m => ({ ...m, [field]: e.target.value }))} placeholder="Column header…"
                    className="flex-1 h-7 rounded-md border border-gray-200 px-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Auto-sync daily at</label>
              <Select value={autoSyncHour} onValueChange={setAutoSyncHour}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-1">Disabled (manual only)</SelectItem>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={() => saveSettingsMutation.mutate()} disabled={saveSettingsMutation.isPending}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5">
                {saveSettingsMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                Save Settings
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
