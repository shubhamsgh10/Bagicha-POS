import { Link, useLocation } from "wouter";
import { BagichaLogo } from "./BagichaLogo";
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Menu, 
  Package, 
  FileText, 
  CreditCard, 
  BarChart3,
  User
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Orders", href: "/orders", icon: ShoppingCart },
  { name: "Menu", href: "/menu", icon: Menu },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "KOT", href: "/kot", icon: FileText },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Reports", href: "/reports", icon: BarChart3 },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="w-64 bg-card shadow-lg flex flex-col">
      <div className="p-6 border-b border-border">
        <BagichaLogo />
        <p className="text-xs text-muted-foreground mt-1">Restaurant POS</p>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <a className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                isActive 
                  ? 'bg-primary text-primary-foreground' 
                  : 'hover:bg-muted text-foreground'
              }`}>
                <item.icon className="w-5 h-5" />
                <span>{item.name}</span>
              </a>
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-border">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Admin User</p>
            <p className="text-xs text-muted-foreground">Manager</p>
          </div>
        </div>
      </div>
    </div>
  );
}
