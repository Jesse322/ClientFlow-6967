import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, differenceInDays, parseISO, isValid } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  try {
    const d = parseISO(dateStr);
    return isValid(d) ? format(d, "MMM d, yyyy") : "—";
  } catch {
    return "—";
  }
}

export function daysUntil(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  try {
    const d = parseISO(dateStr);
    return isValid(d) ? differenceInDays(d, new Date()) : null;
  } catch {
    return null;
  }
}

export function urgencyLabel(days: number | null): string {
  if (days === null) return "";
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days <= 7) return `${days}d left`;
  if (days <= 30) return `${days}d left`;
  return `${days}d`;
}

export function statusColor(status: string | undefined): string {
  switch (status) {
    case "Completed":
    case "Closed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "In Progress":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "Overdue":
      return "bg-red-50 text-red-700 border-red-200";
    case "Stuck":
      return "bg-orange-50 text-orange-700 border-orange-200";
    case "Not Started":
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

/** Derive the effective display status — completed items are NEVER overdue */
export function effectiveStatus(
  status: string | undefined,
  deadline: string | undefined
): string {
  if (status === "Completed") return "Completed";
  if (!status || status === "Not Started" || status === "In Progress") {
    const days = daysUntil(deadline);
    if (days !== null && days < 0) return "Overdue";
  }
  return status || "Not Started";
}

export function priorityColor(priority: string | undefined): string {
  switch (priority) {
    case "High": return "bg-red-50 text-red-700 border-red-200";
    case "Medium": return "bg-amber-50 text-amber-700 border-amber-200";
    case "Low": return "bg-slate-50 text-slate-600 border-slate-200";
    default: return "bg-slate-50 text-slate-500 border-slate-200";
  }
}

export function typeColor(type: string | undefined): string {
  switch (type) {
    case "IRS": return "bg-purple-50 text-purple-700 border-purple-200";
    case "ERISA": return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "CMS": return "bg-cyan-50 text-cyan-700 border-cyan-200";
    case "USI": return "bg-blue-50 text-blue-700 border-blue-200";
    case "Carrier": return "bg-teal-50 text-teal-700 border-teal-200";
    case "Client": return "bg-orange-50 text-orange-700 border-orange-200";
    default: return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

export function urgencyColor(days: number | null): string {
  if (days === null) return "text-slate-400";
  if (days < 0) return "text-red-600 font-semibold";
  if (days <= 7) return "text-red-500 font-medium";
  if (days <= 30) return "text-amber-600 font-medium";
  return "text-slate-500";
}

export function formatRevenue(n: number | undefined): string {
  if (!n) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
