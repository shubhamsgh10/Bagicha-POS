import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Printer, Clock, CheckCircle } from "lucide-react";
import { KOT_STATUS } from "@/lib/constants";

export default function KOT() {
  const { data: kotTickets, isLoading } = useQuery({
    queryKey: ['/api/kot'],
  });

  const getTicketsByStatus = (status: string) => {
    return kotTickets?.filter((ticket: any) => ticket.status === status) || [];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:
        return 'bg-red-500';
      case KOT_STATUS.IN_PROGRESS:
        return 'bg-yellow-500';
      case KOT_STATUS.COMPLETED:
        return 'bg-green-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case KOT_STATUS.PENDING:
        return <Clock className="w-4 h-4" />;
      case KOT_STATUS.IN_PROGRESS:
        return <FileText className="w-4 h-4" />;
      case KOT_STATUS.COMPLETED:
        return <CheckCircle className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)} hr ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <Header title="KOT" description="Loading KOT tickets..." />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-muted rounded w-1/2 mb-3"></div>
                  <div className="h-2 bg-muted rounded w-full"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <Header 
        title="KOT (Kitchen Order Tickets)" 
        description="Manage kitchen orders and track preparation status"
      />

      <main className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all">All Tickets</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="in-progress">In Progress</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {kotTickets?.map((ticket: any) => (
                <Card key={ticket.id} className="bg-card shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-base">{ticket.kotNumber}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {formatTime(ticket.printedAt)}
                        </p>
                      </div>
                      <Badge className={`${getStatusColor(ticket.status)} text-white`}>
                        <span className="flex items-center space-x-1">
                          {getStatusIcon(ticket.status)}
                          <span className="capitalize">{ticket.status.replace('-', ' ')}</span>
                        </span>
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 mb-4">
                      <h4 className="font-medium text-sm">Items:</h4>
                      {ticket.items?.map((item: any, index: number) => (
                        <div key={index} className="flex justify-between items-center text-sm">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground">x{item.quantity}</span>
                        </div>
                      ))}
                    </div>
                    
                    <div className="flex space-x-2">
                      <Button size="sm" variant="outline" className="flex-1">
                        <Printer className="w-3 h-3 mr-1" />
                        Print
                      </Button>
                      {ticket.status === KOT_STATUS.PENDING && (
                        <Button size="sm" className="flex-1">
                          Start Cooking
                        </Button>
                      )}
                      {ticket.status === KOT_STATUS.IN_PROGRESS && (
                        <Button size="sm" className="flex-1 bg-green-500 hover:bg-green-600">
                          Mark Ready
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {Object.values(KOT_STATUS).map((status) => (
            <TabsContent key={status} value={status} className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {getTicketsByStatus(status).map((ticket: any) => (
                  <Card key={ticket.id} className="bg-card shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-base">{ticket.kotNumber}</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {formatTime(ticket.printedAt)}
                          </p>
                        </div>
                        <Badge className={`${getStatusColor(ticket.status)} text-white`}>
                          <span className="flex items-center space-x-1">
                            {getStatusIcon(ticket.status)}
                            <span className="capitalize">{ticket.status.replace('-', ' ')}</span>
                          </span>
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 mb-4">
                        <h4 className="font-medium text-sm">Items:</h4>
                        {ticket.items?.map((item: any, index: number) => (
                          <div key={index} className="flex justify-between items-center text-sm">
                            <span>{item.name}</span>
                            <span className="text-muted-foreground">x{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                      
                      <div className="flex space-x-2">
                        <Button size="sm" variant="outline" className="flex-1">
                          <Printer className="w-3 h-3 mr-1" />
                          Print
                        </Button>
                        {ticket.status === KOT_STATUS.PENDING && (
                          <Button size="sm" className="flex-1">
                            Start Cooking
                          </Button>
                        )}
                        {ticket.status === KOT_STATUS.IN_PROGRESS && (
                          <Button size="sm" className="flex-1 bg-green-500 hover:bg-green-600">
                            Mark Ready
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                {getTicketsByStatus(status).length === 0 && (
                  <div className="col-span-full text-center py-12">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No {status} tickets</h3>
                    <p className="text-muted-foreground">
                      All {status} KOT tickets will appear here
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
