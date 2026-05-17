import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ExpandCardProps {
  title?: string;
  description?: string;
  expandedContent?: React.ReactNode;
  color?: string;
  speed?: number;
  className?: string;
  children?: React.ReactNode;
}

export function ExpandCard({
  title = "Expand Card",
  description = "Hover to reveal hidden content below",
  expandedContent,
  color = "#0ea5e9",
  speed = 0.35,
  className,
  children,
}: ExpandCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isTapped, setIsTapped] = useState(false);

  const isOpen = isHovered || isTapped;

  const handleTouch = (e: React.TouchEvent) => {
    // Only toggle if the touch target isn't a button/link/input inside the card
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    e.preventDefault();
    setIsTapped((v) => !v);
  };

  return (
    <div
      className={cn("relative rounded-xl overflow-hidden cursor-pointer bg-card border transition-all duration-300", isOpen ? "-translate-y-1.5" : "", className)}
      style={{
        borderColor: isOpen ? `${color}55` : undefined,
        boxShadow: isOpen
          ? `0 16px 32px rgba(0,0,0,0.14), 0 4px 10px rgba(0,0,0,0.08), 0 20px 20px -10px ${color}22`
          : "0 2px 8px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.05)",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchEnd={handleTouch}
    >
      {/* Accent bar */}
      <motion.div
        className="h-0.5 w-full"
        style={{ backgroundColor: color, transformOrigin: "left" }}
        animate={{ scaleX: isOpen ? 1 : 0 }}
        initial={{ scaleX: 0 }}
        transition={{ duration: speed }}
      />

      {/* Static content */}
      <div className="p-5">
        {children ?? (
          <>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </>
        )}
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isOpen && expandedContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: speed, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-border pt-3">
              {expandedContent}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
