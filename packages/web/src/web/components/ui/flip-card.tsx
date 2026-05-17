import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FlipCardProps {
  frontTitle?: string;
  frontDescription?: string;
  backTitle?: string;
  backDescription?: string;
  speed?: number;
  color?: string;
  className?: string;
  frontChildren?: React.ReactNode;
  backChildren?: React.ReactNode;
}

export function FlipCard({
  frontTitle = "Hover Me",
  frontDescription = "There's something on the other side...",
  backTitle = "Surprise!",
  backDescription = "You found the back of the card!",
  speed = 0.6,
  color = "#0ea5e9",
  className,
  frontChildren,
  backChildren,
}: FlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [lockedFlipped, setLockedFlipped] = useState(false);

  const handleMouseEnter = () => { if (!lockedFlipped) setIsFlipped(true); };
  const handleMouseLeave = () => { if (!lockedFlipped) setIsFlipped(false); };
  const handleClick = () => {
    const next = !lockedFlipped;
    setLockedFlipped(next);
    setIsFlipped(next);
  };

  return (
    <div
      className={cn("relative cursor-pointer transition-transform duration-300", isFlipped ? "-translate-y-1.5" : "hover:-translate-y-1", className)}
      style={{
        perspective: 1000,
        filter: isFlipped
          ? "drop-shadow(0 12px 24px rgba(0,0,0,0.18)) drop-shadow(0 4px 8px rgba(0,0,0,0.10))"
          : "drop-shadow(0 4px 12px rgba(0,0,0,0.10)) drop-shadow(0 1px 3px rgba(0,0,0,0.06))",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <motion.div
        className="relative w-full h-full"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: speed, ease: "easeInOut" }}
        style={{ transformStyle: "preserve-3d" }}
      >
        {/* Front */}
        <div
          className="absolute inset-0 rounded-xl p-5 flex flex-col justify-between bg-card border border-border"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${color}22`, border: `1px solid ${color}44` }}
          >
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          </div>
          <div>
            {frontChildren ?? (
              <>
                <h3 className="text-sm font-semibold text-foreground">{frontTitle}</h3>
                <p className="text-xs text-muted-foreground mt-1">{frontDescription}</p>
              </>
            )}
          </div>
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl p-5 flex flex-col justify-between border"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            backgroundColor: color,
            borderColor: `${color}cc`,
          }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-white/80" />
          </div>
          <div>
            {backChildren ?? (
              <>
                <h3 className="text-sm font-semibold text-white">{backTitle}</h3>
                <p className="text-xs text-white/80 mt-1">{backDescription}</p>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
