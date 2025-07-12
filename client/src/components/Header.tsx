import { Button } from "@/components/ui/button";
import { Plus, Clock } from "lucide-react";
import { useState, useEffect } from "react";

interface HeaderProps {
  title: string;
  description: string;
  onNewOrder?: () => void;
}

export function Header({ title, description, onNewOrder }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  return (
    <header className="bg-card shadow-sm border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-muted rounded-lg px-3 py-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {formatTime(currentTime)}
            </span>
          </div>
          {onNewOrder && (
            <Button 
              onClick={onNewOrder}
              className="touch-button"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Order
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
