interface BagichaLogoProps {
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}

export function BagichaLogo({ size = "md", showIcon = true }: BagichaLogoProps) {
  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  const imgSizes = {
    sm: 32,
    md: 38,
    lg: 48,
  };

  return (
    <div className="flex items-center gap-2">
      {showIcon && (
        <img
          src="/bagicha-logo.png"
          alt="Bagicha logo"
          width={imgSizes[size]}
          height={imgSizes[size]}
          className="shrink-0"
          style={{ objectFit: "contain", mixBlendMode: "multiply" }}
        />
      )}
      <div className={`bagicha-logo ${textSizes[size]}`}>
        <span className="bag">BAG</span>
        <span className="icha">ICHA</span>
      </div>
    </div>
  );
}
