import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  addMonths, startOfMonth, endOfMonth, eachDayOfInterval,
  format, getDay, isToday, isAfter, startOfDay,
} from "date-fns";
import {
  ChevronLeft, ChevronRight, Wallet, CalendarClock, Clock,
  CheckCircle2, XCircle, Plane, Sparkles, TrendingUp,
} from "lucide-react";
import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { queryClient } from "@/lib/queryClient";

// ── types ───────────────────────────────────────────────────────────────────────
interface AttRecord {
  id: number; userId: number; date: string;
  clockIn: string | null; clockOut: string | null;
  status: string; workingHours: string | null; overtimeHours: string | null;
}
interface PayrollRow {
  userId: number; username: string; role: string;
  monthlySalary: number; workingDays: number; daysPresent: number; halfDays: number;
  approvedLeaves: number; absentDays: number; deductions: number;
  overtimeHours: number; overtimePay: number; netSalary: number;
}

// ── status visual language ────────────────────────────────────────────────────────
const STATUS: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  present:    { label: "Present",  color: "#047857", bg: "rgba(16,185,129,0.13)", dot: "#10b981" },
  "half-day": { label: "Half day", color: "#b45309", bg: "rgba(245,158,11,0.15)", dot: "#f59e0b" },
  absent:     { label: "Absent",   color: "#b91c1c", bg: "rgba(239,68,68,0.12)",  dot: "#ef4444" },
  "on-leave": { label: "Leave",    color: "#0369a1", bg: "rgba(14,165,233,0.13)", dot: "#0ea5e9" },
  holiday:    { label: "Holiday",  color: "#6d28d9", bg: "rgba(139,92,246,0.13)", dot: "#8b5cf6" },
};

const glass: React.CSSProperties = {
  background: "var(--paper-0)",
  backdropFilter: "blur(20px) saturate(1.6)",
  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  border: "1px solid var(--line)",
  boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
};

function fmtHours(h: number): string {
  if (!h) return "0h";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MyAttendance() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const monthKey = format(cursor, "yyyy-MM");
  const { lastMessage } = useRealtime();

  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"], staleTime: 60_000 });
  const symbol = settings?.currencySymbol ?? "₹";

  const { data: records = [] } = useQuery<AttRecord[]>({
    queryKey: [`/api/attendance/me?month=${monthKey}`],
  });
  const { data: pay } = useQuery<PayrollRow | null>({
    queryKey: [`/api/payroll/me/${monthKey}`],
  });

  // Live refresh when this user's attendance changes on the device feed
  useEffect(() => {
    if (lastMessage?.type !== "ATTENDANCE_UPDATE") return;
    const ids = (lastMessage as any).userIds as number[] | undefined;
    if (user && ids && !ids.includes(user.id)) return;
    queryClient.invalidateQueries({ queryKey: [`/api/attendance/me?month=${monthKey}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/payroll/me/${monthKey}`] });
  }, [lastMessage, monthKey, user]);

  const byDate = useMemo(() => {
    const m = new Map<string, AttRecord>();
    for (const r of records) m.set(r.date, r);
    return m;
  }, [records]);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }),
    [cursor],
  );
  const leadBlanks = getDay(startOfMonth(cursor)); // 0=Sun
  const todayStart = startOfDay(new Date());

  // Month tallies (from records that exist)
  const tally = useMemo(() => {
    let present = 0, half = 0, absent = 0, leave = 0, hours = 0, ot = 0;
    for (const r of records) {
      if (r.status === "present") present++;
      else if (r.status === "half-day") half++;
      else if (r.status === "absent") absent++;
      else if (r.status === "on-leave") leave++;
      hours += parseFloat(r.workingHours ?? "0") || 0;
      ot += parseFloat(r.overtimeHours ?? "0") || 0;
    }
    return { present, half, absent, leave, hours, ot };
  }, [records]);

  const money = (n: number) =>
    `${symbol}${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const stats = [
    { label: "Present",  value: tally.present, icon: CheckCircle2, color: "#10b981", bg: "rgba(16,185,129,0.10)" },
    { label: "Half day", value: tally.half,    icon: Clock,        color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
    { label: "Absent",   value: tally.absent,  icon: XCircle,      color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
    { label: "Leaves",   value: tally.leave,   icon: Plane,        color: "#0ea5e9", bg: "rgba(14,165,233,0.10)" },
    { label: "Hours",    value: fmtHours(tally.hours), icon: CalendarClock, color: "#34507A", bg: "rgba(52,80,122,0.10)" },
    { label: "Overtime", value: fmtHours(tally.ot),    icon: TrendingUp,    color: "#8b5cf6", bg: "rgba(139,92,246,0.10)" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="My Attendance"
        description="Your day-by-day attendance & this month's pay"
        action={
          <div style={{ ...glass, borderRadius: 12, padding: 4, display: "flex", alignItems: "center", gap: 2 }}>
            <button onClick={() => setCursor((c) => addMonths(c, -1))}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", borderRadius: 8, display: "flex" }}>
              <ChevronLeft size={16} color="#374151" />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111827", minWidth: 116, textAlign: "center" }}>
              {format(cursor, "MMMM yyyy")}
            </span>
            <button onClick={() => setCursor((c) => addMonths(c, 1))}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", borderRadius: 8, display: "flex" }}>
              <ChevronRight size={16} color="#374151" />
            </button>
          </div>
        }
      />

      <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 sm:p-6 space-y-4 sm:space-y-5">

        {/* ── Net-pay hero ─────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          style={{
            borderRadius: 22, padding: "22px 24px", color: "white", position: "relative", overflow: "hidden",
            background: "linear-gradient(135deg,#059669 0%,#0d9488 55%,#0ea5e9 130%)",
            boxShadow: "0 18px 44px rgba(13,148,136,0.36)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, opacity: 0.18,
            backgroundImage: "radial-gradient(circle at 88% 18%, rgba(255,255,255,0.9), transparent 42%)" }} />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.92 }}>
                <Wallet size={16} />
                <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.04em" }}>
                  NET PAY · {format(cursor, "MMMM")}
                </span>
              </div>
              <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.1, marginTop: 6, letterSpacing: "-0.02em" }}>
                {pay ? money(pay.netSalary) : "—"}
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>
                Hi {user?.username ?? "there"} — keep up the great work
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 22px", fontSize: 12.5 }}>
              <PayBit label="Monthly salary" value={pay ? money(pay.monthlySalary) : "—"} />
              <PayBit label="Days present" value={pay ? `${pay.daysPresent}/${pay.workingDays}` : "—"} />
              <PayBit label="Deductions" value={pay ? `– ${money(pay.deductions)}` : "—"} />
              <PayBit label="Overtime pay" value={pay ? `+ ${money(pay.overtimePay)}` : "—"} />
            </div>
          </div>
        </motion.div>

        {/* ── Month stat strip ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 sm:gap-3">
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04, type: "spring", stiffness: 280, damping: 22 }}
              style={{ ...glass, borderRadius: 14, padding: "12px 13px" }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
                <s.icon size={15} color={s.color} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: "#6b7280", fontWeight: 600, marginTop: 1 }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* ── Calendar ─────────────────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          style={{ ...glass, borderRadius: 20, padding: "16px 16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <CalendarClock size={16} color="#0d9488" />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Daily attendance</h3>
          </div>

          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {DOW.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#9ca3af", paddingBottom: 2 }}>{d}</div>
            ))}
            {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const rec = byDate.get(key);
              const future = isAfter(startOfDay(d), todayStart);
              const today = isToday(d);
              const st = rec ? STATUS[rec.status] : undefined;

              const cellBg = st ? st.bg : "rgba(255,255,255,0.5)";
              const border = today ? "2px solid #0d9488" : "1px solid rgba(0,0,0,0.05)";

              return (
                <div key={key} title={rec ? `${st?.label}${rec.clockIn ? ` · ${rec.clockIn}${rec.clockOut ? `–${rec.clockOut}` : ""}` : ""}` : ""}
                  style={{
                    minHeight: 60, borderRadius: 11, padding: "6px 7px", background: cellBg, border,
                    opacity: future ? 0.45 : 1, display: "flex", flexDirection: "column", justifyContent: "space-between",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: today ? "#0d9488" : "#374151" }}>{format(d, "d")}</span>
                    {st && <span style={{ width: 7, height: 7, borderRadius: 99, background: st.dot }} />}
                  </div>
                  {rec ? (
                    <div style={{ lineHeight: 1.25 }}>
                      {rec.clockIn && (
                        <div style={{ fontSize: 9.5, fontWeight: 600, color: st?.color }}>
                          {rec.clockIn}{rec.clockOut ? `–${rec.clockOut}` : " ·"}
                        </div>
                      )}
                      <div style={{ fontSize: 9, fontWeight: 700, color: st?.color, opacity: 0.85 }}>{st?.label}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 9, color: "#cbd5e1", fontWeight: 600 }}>
                      {future ? "" : "—"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* legend */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
            {Object.values(STATUS).map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: s.dot }} />
                <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>{s.label}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={12} color="#0d9488" />
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>Updates live as you punch</span>
            </div>
          </div>
        </motion.div>

        {!pay && (
          <p style={{ textAlign: "center", fontSize: 12.5, color: "#9ca3af", padding: "4px 0 8px" }}>
            No payroll profile yet — ask your manager to set your salary &amp; biometric ID.
          </p>
        )}
      </main>
    </div>
  );
}

function PayBit({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ opacity: 0.82, fontSize: 11, fontWeight: 500 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}
