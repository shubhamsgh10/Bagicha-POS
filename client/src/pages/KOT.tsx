import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { FileText, Printer, Clock, CheckCircle, ChefHat } from "lucide-react";
import { KOT_STATUS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PrintPreviewModal, type PrintPreview } from "@/components/PrintPreviewModal";
import { kotLines } from "@/lib/receiptText";


const statusAccent: Record<string, string> = {
  pending:     "border-l-red-400 bg-red-50/40",
  "in-progress": "border-l-yellow-400 bg-yellow-50/40",
  completed:   "border-l-emerald-400 bg-emerald-50/30",
};

const statusBadge: Record<string, string> = {
  pending:     "bg-red-100/80 text-red-700",
  "in-progress": "bg-yellow-100/80 text-yellow-700",
  completed:   "bg-emerald-100/80 text-emerald-700",
};

export default function KOT() {
  const { toast } = useToast();
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);

  const showKOTPreview = (ticket: any) => {
    const lines = kotLines({
      kotNumber: ticket.kotNumber,
      tableNumber: ticket.tableNumber ?? null,
      items: (ticket.items ?? []).map((i: any) => ({
        name: i.name,
        quantity: i.quantity,
        size: i.size ?? null,
        notes: i.instructions ?? i.notes ?? null,
      })),
      isReprint: true,
    });
    setPrintPreview({ title: 'KOT Preview', lines });
  };

  const reprintKOT = async (ticket: any) => {
    try {
      const res = await fetch('/api/print/kot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticket.orderId, reprint: true }),
        credentials: 'include',
      });
      if (!res.ok) {
        showKOTPreview(ticket);
      } else {
        toast({ title: 'KOT sent to printer!' });
      }
    } catch {
      showKOTPreview(ticket);
    }
  };

  const [activeTab, setActiveTab] = useState("active");

  const { data: kotTickets, isLoading } = useQuery<any[]>({
    queryKey: ["/api/kot"],
    refetchInterval: 15000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/kot/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const getTicketsByStatus = (status: string) =>
    kotTickets?.filter((ticket: any) => ticket.status === status) || [];

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:     return <Clock className="w-3 h-3" />;
      case KOT_STATUS.IN_PROGRESS: return <ChefHat className="w-3 h-3" />;
      case KOT_STATUS.COMPLETED:   return <CheckCircle className="w-3 h-3" />;
      default: return <FileText className="w-3 h-3" />;
    }
  };

  const KOTCard = ({ ticket, idx }: { ticket: any; idx: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.04, duration: 0.2 }}
      className={`rounded-2xl bg-white/40 border border-white/30 shadow-md
                  border-l-4 ${statusAccent[ticket.status] || "border-l-gray-300"}
                  hover:shadow-xl hover:bg-white/50 transition-all duration-200`}
    >
      <div className="px-4 pt-3 pb-2 flex justify-between items-start">
        <div>
          <p className="font-bold text-gray-800">{ticket.kotNumber}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatTime(ticket.printedAt)}</p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg ${statusBadge[ticket.status] || "bg-gray-100/80 text-gray-600"}`}>
          {getStatusIcon(ticket.status)}
          <span className="capitalize">{ticket.status.replace("-", " ")}</span>
        </span>
      </div>

      <div className="px-4 pb-2 space-y-1.5">
        {ticket.items?.map((item: any, index: number) => (
          <div key={index}>
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium text-gray-700">{item.name}</span>
              <span className="font-bold text-emerald-600">×{item.quantity}</span>
            </div>
            {item.instructions && (
              <p className="text-xs text-gray-400 ml-2 italic">{item.instructions}</p>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 pb-3 flex gap-2 border-t border-white/40 pt-2.5">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => reprintKOT(ticket)}
          className="flex-1 flex items-center justify-center gap-1 text-xs font-medium py-1.5 rounded-lg
                     bg-white/60 border border-white/40 text-gray-600 hover:bg-white/80 transition-all"
        >
          <Printer className="w-3 h-3" /> Print KOT
        </motion.button>

        {ticket.status === KOT_STATUS.PENDING && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            disabled={updateStatusMutation.isPending}
            onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "in-progress" })}
            className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold py-1.5 rounded-lg
                       bg-yellow-400/80 text-yellow-900 hover:bg-yellow-400 transition-all"
          >
            <ChefHat className="w-3 h-3" /> Start Cooking
          </motion.button>
        )}

        {ticket.status === KOT_STATUS.IN_PROGRESS && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            disabled={updateStatusMutation.isPending}
            onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "completed" })}
            className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold py-1.5 rounded-lg
                       bg-gradient-to-r from-emerald-500 to-green-500 text-white hover:shadow-md transition-all"
          >
            <CheckCircle className="w-3 h-3" /> Mark Ready
          </motion.button>
        )}
      </div>
    </motion.div>
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
        <Header title="Kitchen — KOT" description="Loading tickets..." />
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-white/40 border border-white/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const pending    = getTicketsByStatus("pending");
  const inProgress = getTicketsByStatus("in-progress");
  const completed  = getTicketsByStatus("completed");

  const tabs = [
    { id: "active",      label: `Active (${pending.length + inProgress.length})` },
    { id: "pending",     label: `Pending (${pending.length})` },
    { id: "in-progress", label: `Cooking (${inProgress.length})` },
    { id: "all",         label: `All (${kotTickets?.length || 0})` },
  ];

  const ticketsForTab = () => {
    switch (activeTab) {
      case "pending":     return pending;
      case "in-progress": return inProgress;
      case "all":         return kotTickets || [];
      default:            return [...pending, ...inProgress];
    }
  };

  const emptyIcon = () => {
    if (activeTab === "pending") return <Clock className="w-10 h-10 mx-auto mb-3 text-gray-300" />;
    if (activeTab === "in-progress") return <ChefHat className="w-10 h-10 mx-auto mb-3 text-gray-300" />;
    return <ChefHat className="w-10 h-10 mx-auto mb-3 text-gray-300" />;
  };

  const emptyText = () => {
    if (activeTab === "pending") return "No pending orders";
    if (activeTab === "in-progress") return "Nothing cooking right now";
    if (activeTab === "all") return "No KOT tickets found";
    return "No active orders";
  };

  const currentTickets = ticketsForTab();

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <Header
        title="Kitchen — KOT"
        description={`${pending.length} pending · ${inProgress.length} cooking · ${completed.length} ready`}
      />

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Glass Tabs */}
        <div className="rounded-xl bg-white/40 border border-white/30 p-1 flex flex-wrap gap-1 mb-5">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-sm"
                  : "text-gray-600 hover:bg-white/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {currentTickets.length === 0 ? (
          <div className="text-center py-16 rounded-2xl bg-white/30 border border-white/30">
            {emptyIcon()}
            <p className="font-medium text-gray-500">{emptyText()}</p>
            <p className="text-sm text-gray-400 mt-1">New orders will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentTickets.map((ticket: any, idx: number) => (
              <KOTCard key={ticket.id} ticket={ticket} idx={idx} />
            ))}
          </div>
        )}
      </main>

      {printPreview && (
        <PrintPreviewModal preview={printPreview} onClose={() => setPrintPreview(null)} />
      )}
    </div>
  );
}
