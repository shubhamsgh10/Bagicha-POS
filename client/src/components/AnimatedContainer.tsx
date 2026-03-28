import { motion } from "framer-motion";

interface AnimatedContainerProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  layout?: boolean;
}

/**
 * AnimatedContainer — Drop-in wrapper for any card, panel, or section.
 * Fades + slides in on mount. Use delay to stagger siblings.
 */
export function AnimatedContainer({
  children,
  className = "",
  delay = 0,
  layout = false,
}: AnimatedContainerProps) {
  return (
    <motion.div
      layout={layout}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
