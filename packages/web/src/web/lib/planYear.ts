/**
 * Determines which plan year a deadline belongs to.
 *
 * Key rule: for renewal-based phases (Pre-Renewal, Marketing, Implementation,
 * Post-Renewal), the plan year = the year of the NEXT renewal on or after
 * the deadline — i.e. the renewal the deliverable is PREPARING FOR.
 *
 * For compliance items (ACA, CMS, RxDC, PCORI, 5500) the plan year is
 * determined by the reporting period the filing covers.
 */
export function getPlanYear(
  deadline: string | undefined,
  renewalDate: string | undefined,
  phase?: string,
  deliverableName?: string
): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  const name = (deliverableName || "").toLowerCase();

  // ── Calendar-year compliance items ──────────────────────────────
  // ACA (1094-C, 1095-C), CMS Creditable Coverage, RxDC:
  // Filed for the previous calendar year.
  if (
    name.includes("aca") ||
    name.includes("1094") ||
    name.includes("1095") ||
    name.includes("creditable coverage") ||
    name.includes("rxdc")
  ) {
    return d.getFullYear() - 1;
  }

  // ── PCORI / Form 720 ────────────────────────────────────────────
  if (name.includes("pcori") || name.includes("form 720")) {
    if (!renewalDate) return d.getFullYear() - 1;
    const renewal = new Date(renewalDate);
    const isJan1 = renewal.getMonth() === 0 && renewal.getDate() === 1;
    return isJan1 ? d.getFullYear() - 1 : d.getFullYear() - 2;
  }

  // ── Renewal-based phases ─────────────────────────────────────────
  // These deliverables are preparing FOR an upcoming renewal.
  // Plan year = the year of the next renewal on or after the deadline.
  const renewalPhases = ["Pre-Renewal", "Marketing", "Implementation", "Post-Renewal"];
  if (phase && renewalPhases.includes(phase)) {
    if (!renewalDate) return d.getFullYear();
    const base = new Date(renewalDate);
    // Find the next occurrence of the renewal month/day on or after the deadline
    let candidate = new Date(d.getFullYear(), base.getMonth(), base.getDate());
    if (candidate < d) candidate = new Date(d.getFullYear() + 1, base.getMonth(), base.getDate());
    return candidate.getFullYear();
  }

  // ── Compliance phase / other ─────────────────────────────────────
  // Plan year = the renewal year the deadline falls within.
  if (!renewalDate) return d.getFullYear();
  const base = new Date(renewalDate);
  let planStart = new Date(d.getFullYear(), base.getMonth(), base.getDate());
  if (planStart > d) planStart = new Date(d.getFullYear() - 1, base.getMonth(), base.getDate());
  return planStart.getFullYear();
}

export function planYearLabel(year: number | null): string {
  if (year === null) return "—";
  return `PY ${year}`;
}

export function getAvailablePlanYears(
  items: Array<{ deadline?: string; renewalDate?: string; phase?: string; name?: string }>
): number[] {
  const years = new Set<number>();
  items.forEach((i) => {
    const y = getPlanYear(i.deadline, i.renewalDate, i.phase, i.name);
    if (y !== null) years.add(y);
  });
  return Array.from(years).sort((a, b) => b - a);
}
