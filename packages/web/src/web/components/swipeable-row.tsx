import { useRef, useState, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";

const ACTION_WIDTH = 112;
const THRESHOLD = 50;

interface Props {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}

export function SwipeableRow({ children, onEdit, onDelete, className }: Props) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const startX = useRef<number | null>(null);
  const startOffset = useRef(0);
  const moved = useRef(false);

  const snapTo = useCallback((target: number) => {
    setAnimating(true);
    setOffset(target);
    setTimeout(() => setAnimating(false), 220);
  }, []);

  const isOpen = offset <= -ACTION_WIDTH / 2;

  // ── Row touch handlers (on the sliding content only) ───────────
  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startOffset.current = offset;
    moved.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    if (Math.abs(dx) < 5 && !moved.current) return;
    moved.current = true;
    const next = Math.max(-ACTION_WIDTH, Math.min(0, startOffset.current + dx));
    setAnimating(false);
    setOffset(next);
  };

  const handleTouchEnd = () => {
    if (!moved.current) { startX.current = null; return; }
    snapTo(offset < -THRESHOLD ? -ACTION_WIDTH : 0);
    startX.current = null;
    moved.current = false;
  };

  return (
    <div className={`relative overflow-hidden select-none ${className ?? ""}`}>
      {/* Action buttons — sit behind, only visible when swiped */}
      <div
        className="absolute right-0 top-0 bottom-0 flex"
        style={{ width: ACTION_WIDTH }}
      >
        <button
          className="flex-1 bg-sky-500 flex flex-col items-center justify-center gap-0.5 text-white active:bg-sky-600 transition-colors"
          onClick={(e) => { e.stopPropagation(); snapTo(0); onEdit(); }}
        >
          <Pencil size={14} />
          <span className="text-[10px] font-medium">Edit</span>
        </button>
        <button
          className="flex-1 bg-red-500 flex flex-col items-center justify-center gap-0.5 text-white active:bg-red-600 transition-colors"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); snapTo(0); onDelete(); }}
        >
          <Trash2 size={14} />
          <span className="text-[10px] font-medium">Delete</span>
        </button>
      </div>

      {/* Sliding foreground */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (isOpen) snapTo(0); }}
        style={{
          transform: `translateX(${offset}px)`,
          transition: animating ? "transform 0.22s ease" : "none",
          willChange: "transform",
          position: "relative",
          zIndex: 1,
          backgroundColor: "white",
        }}
      >
        {children}
      </div>
    </div>
  );
}
