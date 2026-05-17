export type Priority = "Low" | "Medium" | "High" | "Urgent";
export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Urgent"];

export const PRIORITY_ORDER: Record<Priority, number> = {
  Urgent: 0, High: 1, Medium: 2, Low: 3,
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  Urgent: "bg-red-100 text-red-700 border-red-300",
  High:   "bg-orange-100 text-orange-700 border-orange-300",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-300",
  Low:    "bg-slate-100 text-slate-500 border-slate-200",
};

export const PRIORITY_DOT: Record<Priority, string> = {
  Urgent: "bg-red-500",
  High:   "bg-orange-400",
  Medium: "bg-yellow-400",
  Low:    "bg-slate-300",
};

/** Derive priority from due date when not explicitly set */
export function derivePriority(dueDateStr?: string): Priority {
  if (!dueDateStr) return "Low";
  const days = Math.ceil(
    (new Date(dueDateStr + "T12:00:00Z").getTime() - Date.now()) / 86_400_000
  );
  if (days < 0)  return "Urgent"; // overdue
  if (days <= 3) return "Urgent";
  if (days <= 7) return "High";
  if (days <= 14) return "Medium";
  return "Low";
}

/** Effective priority: explicit first, else derived from due date */
export function effectivePriority(priority?: string, dueDate?: string): Priority {
  if (priority && PRIORITIES.includes(priority as Priority)) return priority as Priority;
  return derivePriority(dueDate);
}
