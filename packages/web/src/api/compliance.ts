/**
 * Generates compliance deadlines filtered by funding strategy and company size.
 *
 * Size rules:
 * - Form 5500 / SAR / 5500 Extension: exempt if < 100 employees (size "1-49" or "50-99")
 *   Note: plans with < 100 participants at start of plan year qualify for small plan exemption
 * - ACA 1094/1095-C: only Applicable Large Employers (50+ FTEs). Skip for "1-49".
 * - PCORI/Form 720: Self Funded & Level Funded only (all sizes)
 *
 * Funding rules:
 * - PCORI: Self Funded + Level Funded only
 * - HIPAA Privacy Notice (self-insured plans): technically all, but most critical for Self Funded
 */

export interface ComplianceDeadline {
  name: string;
  type: "IRS" | "ERISA" | "CMS" | "USI" | "Carrier" | "Client";
  deadline: string;
  phase: "Compliance";
  notes: string;
  skippedReason?: string; // why this was excluded (for preview)
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + days); return r;
}
function addMonths(d: Date, months: number): Date {
  const r = new Date(d); r.setMonth(r.getMonth() + months); return r;
}
function nextRenewal(renewalDateStr: string): Date {
  const d = new Date(renewalDateStr);
  const today = new Date();
  while (d <= today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
function planYearEnd(nextRenewalDate: Date): Date {
  return addDays(nextRenewalDate, -1);
}

/** Returns true if company size is < 100 employees */
function isSmallPlan(companySize: string): boolean {
  return ["1-49", "50-99"].includes(companySize);
}

/** Returns true if size is < 50 (not an ALE) */
function isNonALE(companySize: string): boolean {
  return companySize === "1-49";
}

export function generateComplianceDeadlines(
  renewalDateStr: string,
  fundingStrategy: string,
  clientId: string,
  companySize: string = ""
): ComplianceDeadline[] {
  const renewal = nextRenewal(renewalDateStr);
  const pyEnd = planYearEnd(renewal);
  const isSelfOrLevel = ["Self Funded", "Level Funded"].includes(fundingStrategy);
  const smallPlan = isSmallPlan(companySize);
  const nonALE = isNonALE(companySize);
  const deadlines: ComplianceDeadline[] = [];

  // ── Form 5500 ────────────────────────────────────────────────────────────
  // Small plan exemption: plans with < 100 participants at start of plan year
  // are generally exempt (unfunded/insured welfare plans)
  if (!smallPlan) {
    const f5500Due = addMonths(pyEnd, 7);
    deadlines.push({
      name: "Form 5500 Filing",
      type: "ERISA",
      deadline: isoDate(f5500Due),
      phase: "Compliance",
      notes: `Due 7 months after plan year end (${isoDate(pyEnd)}). File with DOL via EFAST2. Required for plans with 100+ participants.`,
    });

    const f5500Ext = addMonths(f5500Due, 2);
    f5500Ext.setDate(f5500Ext.getDate() + 15);
    deadlines.push({
      name: "Form 5500 Extended Deadline",
      type: "ERISA",
      deadline: isoDate(f5500Ext),
      phase: "Compliance",
      notes: "2.5-month automatic extension from original 5500 due date.",
    });

    const sarDue = addMonths(pyEnd, 9);
    deadlines.push({
      name: "Summary Annual Report (SAR)",
      type: "ERISA",
      deadline: isoDate(sarDue),
      phase: "Compliance",
      notes: "Distribute to plan participants within 9 months of plan year end. Required for plans that file a 5500.",
    });
  }

  // ── ACA 1095-C / 1094-C ──────────────────────────────────────────────────
  // Only ALEs (50+ FTEs). Skip entirely for 1-49.
  const acaYear = pyEnd.getFullYear() + 1;
  if (!nonALE) {
    deadlines.push({
      name: "ACA 1095-C Distribution to Employees",
      type: "IRS",
      deadline: isoDate(new Date(acaYear, 2, 1)),
      phase: "Compliance",
      notes: `Distribute 1095-C to all full-time employees by March 1, ${acaYear}. Applies to ALEs (50+ FTEs). ${companySize === "50-99" ? "Verify ALE status based on prior year headcount." : ""}`.trim(),
    });
    deadlines.push({
      name: "ACA 1094-C Electronic Filing",
      type: "IRS",
      deadline: isoDate(new Date(acaYear, 2, 31)),
      phase: "Compliance",
      notes: `E-file 1094-C and 1095-C with IRS by March 31, ${acaYear}. Required for ALEs.`,
    });
  }

  // ── RxDC ─────────────────────────────────────────────────────────────────
  // Required for ALL group health plans regardless of size
  const rxdcYear = pyEnd.getFullYear() + 1;
  deadlines.push({
    name: "RxDC Reporting",
    type: "CMS",
    deadline: isoDate(new Date(rxdcYear, 5, 1)),
    phase: "Compliance",
    notes: `Submit Prescription Drug Data Collection (RxDC) to CMS by June 1, ${rxdcYear}. Required for all group health plans.`,
  });

  // ── PCORI / Form 720 ──────────────────────────────────────────────────────
  // Self Funded & Level Funded only
  if (isSelfOrLevel) {
    const pcoriYear = pyEnd.getFullYear() + 1;
    deadlines.push({
      name: "PCORI Fee Filing (Form 720)",
      type: "IRS",
      deadline: isoDate(new Date(pcoriYear, 6, 31)),
      phase: "Compliance",
      notes: `File Form 720 and pay PCORI fee by July 31, ${pcoriYear}. Required for ${fundingStrategy} plans only. Fee based on average covered lives.`,
    });
  }

  // ── CMS Part D Notice to Enrollees ───────────────────────────────────────
  deadlines.push({
    name: "CMS Medicare Part D — Creditable Coverage Notice",
    type: "CMS",
    deadline: isoDate(addDays(renewal, -60)),
    phase: "Compliance",
    notes: `Distribute Medicare Part D creditable/non-creditable coverage notice to all Medicare-eligible employees at least 60 days before plan year start (${isoDate(renewal)}).`,
  });

  // ── CMS Part D Disclosure to CMS ─────────────────────────────────────────
  deadlines.push({
    name: "CMS Medicare Part D — Annual Disclosure to CMS",
    type: "CMS",
    deadline: isoDate(addDays(renewal, 60)),
    phase: "Compliance",
    notes: `Complete online CMS disclosure within 60 days after plan year start (${isoDate(renewal)}).`,
  });

  // ── SBC ───────────────────────────────────────────────────────────────────
  deadlines.push({
    name: "SBC Distribution",
    type: "ERISA",
    deadline: isoDate(addDays(renewal, -60)),
    phase: "Compliance",
    notes: `Distribute Summary of Benefits and Coverage (SBC) at least 60 days before plan year start. Carriers provide templates.`,
  });

  // ── CHIP Notice ───────────────────────────────────────────────────────────
  deadlines.push({
    name: "CHIP Notice",
    type: "ERISA",
    deadline: isoDate(addDays(renewal, -45)),
    phase: "Compliance",
    notes: `Distribute annual CHIP notice to all employees. Can be included with open enrollment materials.`,
  });

  // ── HIPAA Annual Privacy Notice ───────────────────────────────────────────
  deadlines.push({
    name: "HIPAA Annual Privacy Notice",
    type: "ERISA",
    deadline: isoDate(addDays(renewal, -30)),
    phase: "Compliance",
    notes: `Distribute HIPAA privacy notice annually. Required for self-insured plans; best practice for all plans.`,
  });

  // ── Wrap Document / SPD Review ────────────────────────────────────────────
  deadlines.push({
    name: "Wrap Document / SPD Review",
    type: "ERISA",
    deadline: isoDate(addDays(renewal, -60)),
    phase: "Compliance",
    notes: `Review and update Wrap Plan Document and SPD before plan year start. Updated SPD required within 210 days after plan year end if material changes were made.`,
  });

  deadlines.sort((a, b) => a.deadline.localeCompare(b.deadline));
  return deadlines;
}
