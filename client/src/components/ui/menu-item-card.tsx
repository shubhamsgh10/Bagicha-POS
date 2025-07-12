import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface MenuItemCardProps {
  id: number;
  name: string;
  price: string;
  image?: string;
  soldToday?: number;
  onAdd?: (id: number) => void;
}

export function MenuItemCard({ 
  id, 
  name, 
  price, 
  image, 
  soldToday, 
  onAdd 
}: MenuItemCardProps) {
  const handleAddClick = () => {
    if (onAdd) {
      onAdd(id);
    }
  };

  return (
    <Card className="bg-muted hover:bg-muted/80 transition-colors cursor-pointer">
      <CardContent className="p-4">
        {image && (
          <img 
            src={image} 
            alt={name}
            className="w-full h-32 object-cover rounded-lg mb-3"
          />
        )}
        <h3 className="font-medium text-foreground">{name}</h3>
        <p className="text-muted-foreground text-sm">{price}</p>
        {soldToday !== undefined && (
          <p className="text-green-600 text-sm">{soldToday} sold today</p>
        )}
        {onAdd && (
          <Button 
            onClick={handleAddClick}
            className="mt-2 w-full touch-button"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add to Order
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
