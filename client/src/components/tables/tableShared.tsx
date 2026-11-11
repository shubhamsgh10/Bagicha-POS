import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

/** Shared between the desktop Tables page and the compact mobile view (TablesMobileView). */

export interface Table {
  id: number;
  name: string;
  capacity: number;
  status: "free" | "running" | "billed";
  currentOrderId?: number | null;
  section: string;
  runningTotal?: number;
  orderCreatedAt?: string;
  servedByName?: string | null;
}

export const SECTION_OPTIONS = [
  { value: "inner",   label: "Inner" },
  { value: "outer",   label: "Outer" },
  { value: "vip",     label: "VIP" },
  { value: "terrace", label: "Terrace" },
  { value: "hall",    label: "Hall" },
];

// Warm garden status card styles (free / running / billed)
export const statusConfig = {
  free: {
    style: {
      background: "var(--paper-0)",
      border: "1.5px dashed var(--line-strong)",
      boxShadow: "var(--shadow-xs)",
    },
    nameText: "text-[var(--text-1)]",
    subText: "text-[var(--text-3)]",
  },
  running: {
    style: {
      background: "var(--success-bg)",
      border: "1px solid #BBD9C4",
      boxShadow: "0 4px 20px rgba(46,139,87,0.10)",
    },
    nameText: "text-[var(--green-900)]",
    subText: "text-[var(--green-700)]",
  },
  billed: {
    style: {
      background: "var(--warning-bg)",
      border: "1px solid #EAD9AE",
      boxShadow: "0 4px 20px rgba(198,138,46,0.10)",
    },
    nameText: "text-[var(--clay-700)]",
    subText: "text-[var(--amber-600)]",
  },
};

export const fmt = (n: number) => `₹${n.toFixed(0)}`;

/** Shows elapsed time as "X Min" or "Xh Xm", updates every minute */
export function RunningTimer({ startedAt }: { startedAt: string }) {
  const getElapsed = (s: string) => {
    const totalMins = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return { h, m };
  };
  const [elapsed, setElapsed] = useState(() => getElapsed(startedAt));
  useEffect(() => {
    setElapsed(getElapsed(startedAt));
    const id = setInterval(() => setElapsed(getElapsed(startedAt)), 60000);
    return () => clearInterval(id);
  }, [startedAt]);
  const display = elapsed.h > 0 ? `${elapsed.h}h ${elapsed.m}m` : `${elapsed.m} Min`;
  return <span>{display}</span>;
}

/** Fetches order createdAt when not available from table data */
export function TableTimer({ orderId }: { orderId: number }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/orders", String(orderId)],
    staleTime: Infinity,
  });
  if (!data?.createdAt) return <span>Active</span>;
  return <RunningTimer startedAt={data.createdAt} />;
}

export function sectionLabel(s: string) {
  return SECTION_OPTIONS.find(x => x.value === s)?.label
    ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

export type TableStatus = keyof typeof statusConfig;
