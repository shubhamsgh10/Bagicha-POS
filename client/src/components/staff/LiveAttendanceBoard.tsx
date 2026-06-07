import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { LogIn, LogOut, UserX, Radio } from "lucide-react";
import { useRealtime } from "@/hooks/useRealtime";
import { queryClient } from "@/lib/queryClient";

// /api/staff may return either the profile shape ({ userId, user:{…} }) or a flat
// user shape ({ id, username, role }) depending on route registration — handle both.
interface StaffRow {
  id?: number;
  userId?: number;
  biometricId?: string | null;
  username?: string;
  role?: string;
  user?: { id: number; username: string; role: string };
}
interface AttToday { userId: number; clockIn: string | null; clockOut: string | null; status: string; workingHours: string | null }

const GRAD: [string, string][] = [
  ["#10b981", "#059669"], ["#0ea5e9", "#0284c7"], ["#8b5cf6", "#7c3aed"],
  ["#f59e0b", "#d97706"], ["#ec4899", "#db2777"], ["#14b8a6", "#0d9488"],
];
const glass: React.CSSProperties = {
  background: "var(--paper-0)",
  backdropFilter: "blur(20px) saturate(1.6)",
  WebkitBackdropFilter: "blur(20px) saturate(1.6)",
  border: "1px solid var(--line)",
  boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
};

export function LiveAttendanceBoard() {
  const { lastMessage } = useRealtime();
  const { data: staff = [] } = useQuery<StaffRow[]>({ queryKey: ["/api/staff"] });
  const { data: today = [] } = useQuery<AttToday[]>({ queryKey: ["/api/attendance/today"] });

  useEffect(() => {
    if (lastMessage?.type !== "ATTENDANCE_UPDATE") return;
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/today"] });
  }, [lastMessage]);

  const recByUser = useMemo(() => {
    const m = new Map<number, AttToday>();
    for (const r of today) m.set(r.userId, r);
    return m;
  }, [today]);

  const rows = useMemo(() => staff.map((s) => {
    const uid = s.userId ?? s.user?.id ?? s.id ?? 0;
    const username = s.user?.username ?? s.username ?? "—";
    const rec = recByUser.get(uid);
    const state: "in" | "done" | "out" =
      rec?.clockIn && !rec?.clockOut ? "in" : rec?.clockIn && rec?.clockOut ? "done" : "out";
    return { uid, username, rec, state };
  }), [staff, recByUser]);

  const inNow = rows.filter((r) => r.state === "in").length;
  const done = rows.filter((r) => r.state === "done").length;
  const notIn = rows.filter((r) => r.state === "out").length;

  return (
    <div style={{ ...glass, borderRadius: 20, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", display: "flex" }}>
            <Radio size={16} color="#0d9488" />
            <span style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: 99, background: "#10b981", boxShadow: "0 0 0 0 rgba(16,185,129,0.6)", animation: "pulse 2s infinite" }} />
          </span>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Today · {format(new Date(), "EEE, d MMM")}</h3>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Pill color="#059669" bg="rgba(16,185,129,0.13)" label={`${inNow} in`} />
          <Pill color="#475569" bg="rgba(100,116,139,0.13)" label={`${done} done`} />
          <Pill color="#b45309" bg="rgba(245,158,11,0.13)" label={`${notIn} not in`} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {rows.map((r, i) => {
          const [g0, g1] = GRAD[i % GRAD.length];
          const initials = (r.username || "—").slice(0, 2).toUpperCase();
          const cfg =
            r.state === "in" ? { color: "#059669", bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.4)", Icon: LogIn, text: r.rec?.clockIn ? `In ${r.rec.clockIn}` : "In" }
            : r.state === "done" ? { color: "#475569", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.25)", Icon: LogOut, text: r.rec ? `${r.rec.clockIn}–${r.rec.clockOut}` : "Done" }
            : { color: "#b45309", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.22)", Icon: UserX, text: "Not in" };
          return (
            <motion.div key={r.uid} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              style={{ borderRadius: 14, padding: "11px 12px", background: cfg.bg, border: `1px solid ${cfg.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,${g0},${g1})`, color: "white", fontWeight: 800, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {initials}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.username}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: cfg.color }}>
                  <cfg.Icon size={12} />{cfg.text}
                </div>
              </div>
            </motion.div>
          );
        })}
        {rows.length === 0 && (
          <p style={{ gridColumn: "1 / -1", textAlign: "center", fontSize: 12.5, color: "#9ca3af", padding: "12px 0" }}>
            No staff yet.
          </p>
        )}
      </div>
    </div>
  );
}

function Pill({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <span style={{ padding: "4px 11px", borderRadius: 99, background: bg, color, fontSize: 11.5, fontWeight: 700 }}>{label}</span>
  );
}
