import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS } from "@/lib/constants";

interface OrderCardProps {
  orderNumber: string;
  customerName?: string;
  items: string;
  amount: string;
  status: string;
  source?: string;
  tableNumber?: string;
}

export function OrderCard({ 
  orderNumber, 
  customerName, 
  items, 
  amount, 
  status, 
  source,
  tableNumber 
}: OrderCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case ORDER_STATUS.PENDING:
        return "status-pending";
      case ORDER_STATUS.PREPARING:
        return "status-preparing";
      case ORDER_STATUS.READY:
        return "status-ready";
      case ORDER_STATUS.SERVED:
      case ORDER_STATUS.DELIVERED:
        return "status-served";
      default:
        return "status-pending";
    }
  };

  const getDisplaySource = () => {
    if (source === 'zomato') return 'Z';
    if (source === 'swiggy') return 'S';
    if (source === 'uber-eats') return 'U';
    return orderNumber.replace(/\D/g, '').slice(-2);
  };

  const getSourceColor = () => {
    if (source === 'zomato') return 'bg-red-500';
    if (source === 'swiggy') return 'bg-orange-500';
    if (source === 'uber-eats') return 'bg-green-500';
    return 'bg-primary';
  };

  return (
    <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
      <div className="flex items-center space-x-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium ${getSourceColor()}`}>
          {getDisplaySource()}
        </div>
        <div>
          <h3 className="font-medium text-foreground">
            {tableNumber ? `Table ${tableNumber}` : customerName || 'Online Order'}
          </h3>
          <p className="text-muted-foreground text-sm">{items}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-semibold text-foreground">{amount}</p>
        <Badge className={`${getStatusColor(status)} px-2 py-1 text-xs font-medium`}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      </div>
    </div>
  );
}
