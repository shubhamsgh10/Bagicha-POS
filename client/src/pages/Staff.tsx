import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Users, RefreshCw, Settings2, Clock, TrendingUp,
  CheckCircle2, XCircle, AlertCircle, Loader2, Link2,
  CalendarDays, IndianRupee,
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

function statusBadge(status: string) {
  const map: Record<string, string> = {
    present:  "bg-green-100 text-green-700",
    absent:   "bg-red-100 text-red-700",
    late:     "bg-yellow-100 text-yellow-700",
    "half-day": "bg-blue-100 text-blue-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

// ── types ─────────────────────────────────────────────────────────────────────

interface AttendanceRecord {
  id: number;
  employeeName: string;
  employeeCode: string | null;
  date: string;
  punchIn: string | null;
  punchOut: string | null;
  hoursWorked: string | null;
  status: string;
  source: string;
  syncedAt: string;
}

interface AttendanceSummary {
  name: string;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  totalHours: number;
}

interface StaffPerformance {
  staffId: number | null;
  staffName: string;
  totalOrders: number;
  totalRevenue: number;
  avgBill: number;
}

interface AttendanceSettings {
  sheetUrl: string;
  columnMapping: Record<string, string> | null;
  autoSyncHour: number;
}

interface SheetPreview {
  headers: string[];
  rows: Array<Record<string, string>>;
  error?: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Staff() {
  const { toast } = useToast();

  // date range filters
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate,   setToDate]   = useState(today());
  const [empFilter, setEmpFilter] = useState("all");

  // settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheetUrl,     setSheetUrl]     = useState("");
  const [autoSyncHour, setAutoSyncHour] = useState("-1");
  const [colMapping, setColMapping] = useState<Record<string, string>>({
    employeeName: "", date: "", punchIn: "", punchOut: "", hoursWorked: "", status: "",
  });

  // sheet preview
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── queries ──────────────────────────────────────────────────────────────────

  const { data: attendanceSettings } = useQuery<AttendanceSettings>({
    queryKey: ["/api/attendance/settings"],
    onSuccess: (d) => {
      setSheetUrl(d.sheetUrl ?? "");
      setAutoSyncHour(String(d.autoSyncHour ?? -1));
      if (d.columnMapping) setColMapping({ ...colMapping, ...d.columnMapping });
    },
  });

  const { data: employees = [] } = useQuery<string[]>({
    queryKey: ["/api/attendance/employees"],
  });

  const { data: attendance = [], isLoading: attLoading } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/attendance", fromDate, toDate, empFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (empFilter !== "all") params.set("employee", empFilter);
      const res = await fetch(`/api/attendance?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: summary = [] } = useQuery<AttendanceSummary[]>({
    queryKey: ["/api/attendance/summary", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/attendance/summary?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: performance = [] } = useQuery<StaffPerformance[]>({
    queryKey: ["/api/staff/performance", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/staff/performance?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: syncLog = [] } = useQuery<any[]>({
    queryKey: ["/api/attendance/sync-log"],
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
      sheetUrl,
      columnMapping: colMapping,
      autoSyncHour: parseInt(autoSyncHour),
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

  // ── render ───────────────────────────────────────────────────────────────────

  const hasSheet = !!attendanceSettings?.sheetUrl;
  const lastSync = syncLog[0];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Staff"
        description="Attendance from Google Sheets + sales performance"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-4 h-4 mr-1.5" /> Configure Sheet
            </Button>
            <Button
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !hasSheet}
            >
              {syncMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Syncing…</>
                : <><RefreshCw className="w-4 h-4 mr-1.5" /> Sync Now</>}
            </Button>
          </div>
        }
      />

      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 space-y-5">

        {/* No sheet configured banner */}
        {!hasSheet && (
          <Card className="border-dashed border-amber-300 bg-amber-50">
            <CardContent className="p-5 flex items-center gap-4">
              <Link2 className="w-8 h-8 text-amber-500 shrink-0" />
              <div>
                <p className="font-semibold text-amber-800">Google Sheet not connected</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  Click <strong>Configure Sheet</strong> to paste your biometric export sheet URL and map the columns.
                  Attendance data will be imported automatically once configured.
                </p>
              </div>
              <Button size="sm" className="ml-auto shrink-0 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => setSettingsOpen(true)}>
                Configure
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Last sync info */}
        {lastSync && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            Last sync: {new Date(lastSync.syncedAt).toLocaleString()} —
            {lastSync.status === "success"
              ? <span className="text-green-600">{lastSync.rowsInserted} added, {lastSync.rowsSkipped} updated</span>
              : <span className="text-red-600">failed — {lastSync.error}</span>}
          </div>
        )}

        {/* Date filter row */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-sm w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="h-8 text-sm w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Employee</Label>
            <Select value={empFilter} onValueChange={setEmpFilter}>
              <SelectTrigger className="h-8 text-sm w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="attendance">
          <TabsList>
            <TabsTrigger value="attendance"><CalendarDays className="w-3.5 h-3.5 mr-1.5" />Attendance</TabsTrigger>
            <TabsTrigger value="summary"><Users className="w-3.5 h-3.5 mr-1.5" />Summary</TabsTrigger>
            <TabsTrigger value="performance"><TrendingUp className="w-3.5 h-3.5 mr-1.5" />Sales Performance</TabsTrigger>
          </TabsList>

          {/* ── Attendance tab ── */}
          <TabsContent value="attendance" className="mt-4">
            {attLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : attendance.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No attendance records for this period.</p>
                {hasSheet && <p className="text-xs mt-1">Click <strong>Sync Now</strong> to import from Google Sheets.</p>}
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Punch In</TableHead>
                      <TableHead>Punch Out</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map(rec => (
                      <TableRow key={rec.id}>
                        <TableCell className="font-medium">
                          <div>{rec.employeeName}</div>
                          {rec.employeeCode && <div className="text-xs text-muted-foreground">{rec.employeeCode}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{rec.date}</TableCell>
                        <TableCell className="text-sm font-mono">{rec.punchIn ?? "—"}</TableCell>
                        <TableCell className="text-sm font-mono">{rec.punchOut ?? "—"}</TableCell>
                        <TableCell className="text-sm">{fmtHours(parseFloat(rec.hoursWorked ?? "0"))}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusBadge(rec.status)}`}>
                            {rec.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Summary tab ── */}
          <TabsContent value="summary" className="mt-4">
            {summary.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No data for this period.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.map(s => (
                  <Card key={s.name}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{s.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Present</span>
                        <span className="font-medium">{s.present}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-1 text-red-500"><XCircle className="w-3.5 h-3.5" />Absent</span>
                        <span className="font-medium">{s.absent}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="flex items-center gap-1 text-yellow-500"><AlertCircle className="w-3.5 h-3.5" />Late</span>
                        <span className="font-medium">{s.late}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" />Total Hours</span>
                        <span>{fmtHours(s.totalHours)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Performance tab ── */}
          <TabsContent value="performance" className="mt-4">
            {performance.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No order data for this period.</p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg Bill</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performance.map((p, i) => (
                      <TableRow key={p.staffId ?? "unassigned"}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{i + 1}</span>
                            {p.staffName}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{p.totalOrders}</TableCell>
                        <TableCell className="text-right font-medium">
                          <span className="flex items-center justify-end gap-0.5">
                            <IndianRupee className="w-3 h-3" />{p.totalRevenue.toLocaleString("en-IN")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          <span className="flex items-center justify-end gap-0.5">
                            <IndianRupee className="w-3 h-3" />{Math.round(p.avgBill).toLocaleString("en-IN")}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Settings Dialog ── */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attendance Sheet Settings</DialogTitle>
            <DialogDescription>
              Connect your biometric export Google Sheet. Share the sheet as "Anyone with link can view" first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Sheet URL */}
            <div className="space-y-2">
              <Label>Google Sheet URL</Label>
              <div className="flex gap-2">
                <Input
                  value={sheetUrl}
                  onChange={e => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="text-xs"
                />
                <Button size="sm" variant="outline" onClick={handlePreview} disabled={!sheetUrl || previewLoading}>
                  {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Preview"}
                </Button>
              </div>
            </div>

            {/* Preview result */}
            {preview && (
              <div className="rounded-lg border p-3 space-y-2">
                {preview.error ? (
                  <p className="text-sm text-red-600">{preview.error}</p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">
                      Found {preview.headers.length} columns. Map them below:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.headers.map(h => (
                        <span key={h} className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{h}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Column mapping */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Column Mapping</Label>
              <p className="text-xs text-muted-foreground">
                Type the exact column header name from your sheet for each field.
              </p>
              {([
                ["employeeName", "Employee Name *"],
                ["date",         "Date *"],
                ["punchIn",      "Punch In Time"],
                ["punchOut",     "Punch Out Time"],
                ["hoursWorked",  "Total Hours (if available)"],
                ["status",       "Status column (Present/Absent)"],
                ["employeeCode", "Employee Code / ID"],
              ] as const).map(([field, label]) => (
                <div key={field} className="flex items-center gap-3">
                  <Label className="text-xs w-44 shrink-0 text-muted-foreground">{label}</Label>
                  <Input
                    value={colMapping[field] ?? ""}
                    onChange={e => setColMapping(m => ({ ...m, [field]: e.target.value }))}
                    placeholder="Column header…"
                    className="h-7 text-xs font-mono"
                  />
                </div>
              ))}
            </div>

            {/* Auto sync hour */}
            <div className="space-y-2">
              <Label>Auto-sync daily at</Label>
              <Select value={autoSyncHour} onValueChange={setAutoSyncHour}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-1">Disabled (manual only)</SelectItem>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
              <Button onClick={() => saveSettingsMutation.mutate()} disabled={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Save Settings
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
