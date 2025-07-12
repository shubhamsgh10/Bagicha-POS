import { Leaf } from "lucide-react";

interface BagichaLogoProps {
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

export function BagichaLogo({ size = "md", showIcon = true }: BagichaLogoProps) {
  const sizeClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl"
  };

  const iconSizes = {
    sm: "w-5 h-5",
    md: "w-6 h-6",
    lg: "w-8 h-8"
  };

  return (
    <div className="flex items-center space-x-2">
      {showIcon && (
        <div className="bg-primary rounded-lg p-1.5">
          <Leaf className={`${iconSizes[size]} text-white`} />
        </div>
      )}
      <div className={`bagicha-logo ${sizeClasses[size]}`}>
        <span className="bag">BAG</span>
        <span className="icha">ICHA</span>
      </div>
    </div>
  );
}
