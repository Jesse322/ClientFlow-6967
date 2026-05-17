import { cn, statusColor, priorityColor, typeColor } from "@/lib/utils";

interface BadgeProps {
  label: string | undefined;
  variant?: "status" | "priority" | "type" | "default";
  className?: string;
}

export function StatusBadge({ label, variant = "default", className }: BadgeProps) {
  if (!label) return null;
  const colorClass =
    variant === "status"
      ? statusColor(label)
      : variant === "priority"
      ? priorityColor(label)
      : variant === "type"
      ? typeColor(label)
      : "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
        colorClass,
        className
      )}
    >
      {label}
    </span>
  );
}
