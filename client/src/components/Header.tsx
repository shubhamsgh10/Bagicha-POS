import { Button } from "@/components/ui/button";
import { Plus, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";

interface HeaderProps {
  title: string;
  description: string;
  onNewOrder?: () => void;
  action?: React.ReactNode;
}

export function Header({ title, description, onNewOrder, action }: HeaderProps) {
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
    <header className="bg-card shadow-sm border-b border-border px-4 sm:px-6 py-3 sm:py-4 sticky top-0 z-10">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-2xl font-semibold text-foreground truncate">{title}</h1>
          <p className="text-sm text-muted-foreground truncate hidden sm:block">{description}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {formatTime(currentTime)}
            </span>
          </div>
          {action}
          {onNewOrder && (
            <Button onClick={onNewOrder} className="touch-button min-h-[44px]">
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">New Order</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
