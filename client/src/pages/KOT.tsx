import { useQuery, useMutation } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Printer, Clock, CheckCircle, ChefHat } from "lucide-react";
import { KOT_STATUS } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

function printKOT(ticket: any) {
  const win = window.open("", "_blank", "width=400,height=600");
  if (!win) return;
  win.document.write(`
    <html>
      <head>
        <title>KOT - ${ticket.kotNumber}</title>
        <style>
          body { font-family: monospace; font-size: 14px; margin: 16px; }
          h2 { text-align: center; margin: 0 0 8px; font-size: 18px; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; margin: 4px 0; }
          .item-name { font-weight: bold; }
          .note { font-size: 12px; color: #555; margin-left: 8px; }
          .footer { text-align: center; font-size: 12px; margin-top: 12px; }
        </style>
      </head>
      <body>
        <h2>KOT</h2>
        <div class="row"><span><strong>KOT#:</strong> ${ticket.kotNumber}</span><span>${new Date(ticket.printedAt).toLocaleTimeString()}</span></div>
        <div class="row"><strong>Status:</strong> <span>${ticket.status.replace("-", " ").toUpperCase()}</span></div>
        <div class="divider"></div>
        <div style="font-weight:bold;margin-bottom:4px">ITEMS:</div>
        ${(ticket.items || []).map((item: any) => `
          <div class="row">
            <span class="item-name">${item.name}</span>
            <span>x${item.quantity}</span>
          </div>
          ${item.instructions ? `<div class="note">Note: ${item.instructions}</div>` : ""}
        `).join("")}
        <div class="divider"></div>
        <div class="footer">** Please prepare immediately **</div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
  win.close();
}

export default function KOT() {
  const { toast } = useToast();
  const { data: kotTickets, isLoading } = useQuery({
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:    return "border-red-500 bg-red-50";
      case KOT_STATUS.IN_PROGRESS: return "border-yellow-500 bg-yellow-50";
      case KOT_STATUS.COMPLETED:  return "border-green-500 bg-green-50";
      default: return "border-gray-300 bg-gray-50";
    }
  };

  const getBadgeColor = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:    return "bg-red-500";
      case KOT_STATUS.IN_PROGRESS: return "bg-yellow-500";
      case KOT_STATUS.COMPLETED:  return "bg-green-500";
      default: return "bg-gray-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:    return <Clock className="w-3.5 h-3.5" />;
      case KOT_STATUS.IN_PROGRESS: return <ChefHat className="w-3.5 h-3.5" />;
      case KOT_STATUS.COMPLETED:  return <CheckCircle className="w-3.5 h-3.5" />;
      default: return <FileText className="w-3.5 h-3.5" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const KOTCard = ({ ticket }: { ticket: any }) => (
    <Card className={`border-l-4 ${getStatusColor(ticket.status)} shadow-sm`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-base font-bold">{ticket.kotNumber}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{formatTime(ticket.printedAt)}</p>
          </div>
          <Badge className={`${getBadgeColor(ticket.status)} text-white flex items-center gap-1`}>
            {getStatusIcon(ticket.status)}
            <span className="capitalize text-xs">{ticket.status.replace("-", " ")}</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="space-y-1.5 mb-3">
          {ticket.items?.map((item: any, index: number) => (
            <div key={index}>
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium">{item.name}</span>
                <span className="font-bold text-primary">×{item.quantity}</span>
              </div>
              {item.instructions && (
                <p className="text-xs text-muted-foreground ml-2 italic">{item.instructions}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8"
            onClick={() => printKOT(ticket)}
          >
            <Printer className="w-3 h-3 mr-1" />
            Print KOT
          </Button>
          {ticket.status === KOT_STATUS.PENDING && (
            <Button
              size="sm"
              className="flex-1 text-xs h-8 bg-yellow-500 hover:bg-yellow-600"
              disabled={updateStatusMutation.isPending}
              onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "in-progress" })}
            >
              <ChefHat className="w-3 h-3 mr-1" />
              Start Cooking
            </Button>
          )}
          {ticket.status === KOT_STATUS.IN_PROGRESS && (
            <Button
              size="sm"
              className="flex-1 text-xs h-8 bg-green-500 hover:bg-green-600"
              disabled={updateStatusMutation.isPending}
              onClick={() => updateStatusMutation.mutate({ id: ticket.id, status: "completed" })}
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              Mark Ready
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header title="Kitchen — KOT" description="Loading tickets..." />
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="p-4 h-40" /></Card>
          ))}
        </div>
      </div>
    );
  }

  const pending = getTicketsByStatus("pending");
  const inProgress = getTicketsByStatus("in-progress");
  const completed = getTicketsByStatus("completed");

  return (
    <div className="flex-1 overflow-hidden">
      <Header
        title="Kitchen — KOT"
        description={`${pending.length} pending · ${inProgress.length} cooking · ${completed.length} ready`}
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <Tabs defaultValue="active">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="all">All ({kotTickets?.length || 0})</TabsTrigger>
            <TabsTrigger value="pending" className="data-[state=active]:bg-red-500 data-[state=active]:text-white">
              Pending ({pending.length})
            </TabsTrigger>
            <TabsTrigger value="in-progress" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-white">
              Cooking ({inProgress.length})
            </TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {pending.length === 0 && inProgress.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No active orders</p>
                <p className="text-sm">New orders will appear here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...pending, ...inProgress].map((ticket: any) => (
                  <KOTCard key={ticket.id} ticket={ticket} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {kotTickets?.map((ticket: any) => <KOTCard key={ticket.id} ticket={ticket} />)}
              {!kotTickets?.length && (
                <div className="col-span-full text-center py-16 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No KOT tickets found</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="pending">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pending.map((ticket: any) => <KOTCard key={ticket.id} ticket={ticket} />)}
              {pending.length === 0 && (
                <div className="col-span-full text-center py-16 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>No pending orders</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="in-progress">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {inProgress.map((ticket: any) => <KOTCard key={ticket.id} ticket={ticket} />)}
              {inProgress.length === 0 && (
                <div className="col-span-full text-center py-16 text-muted-foreground">
                  <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Nothing cooking right now</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
