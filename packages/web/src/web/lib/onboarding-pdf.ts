/**
 * PDF generation for the New Client Onboarding Form.
 * Uses jsPDF + jspdf-autotable. Mirrors the USI New Client Onboarding Form structure.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatDate } from "@/lib/utils";
import type { AirtableRecord, Client } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(
    clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean,
    16
  );
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Fetch image and crop to exact dimensions
async function fetchCroppedImageDataUrl(url: string, targetW: number, targetH: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        const scale = Math.max(targetW / img.naturalWidth, targetH / img.naturalHeight);
        const sw = img.naturalWidth * scale;
        const sh = img.naturalHeight * scale;
        const ox = (targetW - sw) / 2;
        const oy = (targetH - sh) / 2;
        ctx.drawImage(img, ox, oy, sw, sh);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

const CHECK = "✓";
const CROSS = "—";
const PX_PER_MM = 3.7795;

type RGB = [number, number, number];

// ─── Checklist definitions (must match onboarding.tsx) ────────────────────────

interface CheckItem {
  key: string;
  label: string;
  required: boolean;
}

const SETUP_CHECKLIST: CheckItem[] = [
  { key: "huddle_done", label: "Internal Huddle with Producer completed", required: true },
  { key: "analyst_submitted", label: "Analyst Assignment Request submitted", required: true },
  { key: "bp_setup_done", label: "BenefitPoint client setup complete", required: false },
  { key: "welcome_kit_sent", label: "New Client Welcome Kit distributed", required: false },
  { key: "ced_setup", label: "CED Annual Setup complete", required: false },
  { key: "post_huddle_done", label: "Post-Onboarding Huddle scheduled", required: false },
  { key: "wrangle_setup", label: "Wrangle setup (if applicable)", required: false },
  { key: "newsletters_confirmed", label: "Confirmed producer setup for USI newsletters", required: false },
];

const DOCUMENT_CHECKLIST: CheckItem[] = [
  { key: "baa_sent", label: "BAA and Client Agreement sent", required: true },
  { key: "comp_disclosure_sent", label: "Compensation Disclosure sent", required: true },
  { key: "bor_letter_sent", label: "BOR Letter to Carrier sent", required: false },
  { key: "logo_release_sent", label: "Client Logo Release sent", required: false },
  { key: "booklets_gathered", label: "Plan Booklets / Certificates gathered", required: false },
  { key: "sbc_gathered", label: "SBC gathered", required: false },
  { key: "wrap_spd_gathered", label: "Wrap SPD gathered", required: false },
  { key: "wrap_plan_gathered", label: "Wrap Plan Document gathered", required: false },
  { key: "cafeteria_gathered", label: "Cafeteria Plan Document gathered", required: false },
  { key: "hipaa_gathered", label: "HIPAA Policies and Procedures gathered", required: false },
  { key: "form5500_gathered", label: "Copy of Most Recent Form 5500 gathered", required: false },
];

const DATA_REQUEST_CHECKLIST: CheckItem[] = [
  { key: "census_received", label: "Current Employee Census received", required: false },
  { key: "carrier_contact_received", label: "Carrier Contact Sheet received", required: false },
  { key: "rates_received", label: "Current Premium Rates & Experience Data received", required: false },
  { key: "plan_docs_received", label: "Plan documents received", required: false },
  { key: "schedule_a_received", label: "Schedule A insurance information received", required: false },
];

const VALUE_ADDS: CheckItem[] = [
  { key: "brc", label: "BRC (Benefit Resource Center)", required: false },
  { key: "mobile_app", label: "USI Mobile App (MyBenefits2Go)", required: false },
  { key: "zywave", label: "Zywave Client Cloud", required: false },
  { key: "usi_3d", label: "USI 3D", required: false },
];

// ─── Main export ──────────────────────────────────────────────────────────────

export async function downloadOnboardingPDF(
  client: AirtableRecord<Client>,
  teamMemberMap: Record<string, string>
) {
  const f = client.fields;
  const od: Record<string, any> = f["Onboarding Data"] || {};
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });

  const PAGE_W = 215.9;
  const PAGE_H = 279.4;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H = 28;

  // ── Theme ─────────────────────────────────────────────
  const themeColor = f["Theme Color"] || null;
  const photoUrl = f["Header Photo URL"]
    ? f["Header Photo Source"] === "upload"
      ? `/api/clients/${client.id}/header-photo`
      : f["Header Photo URL"]
    : null;
  const headerRgb: RGB = themeColor ? hexToRgb(themeColor) : [15, 23, 42];
  const accentRgb: RGB = themeColor ? hexToRgb(themeColor) : [14, 165, 233]; // sky-500 default

  const photoDataUrl = photoUrl
    ? await fetchCroppedImageDataUrl(photoUrl, Math.round(PAGE_W * PX_PER_MM), Math.round(HEADER_H * PX_PER_MM))
    : null;

  // ── Reusable helpers ─────────────────────────────────
  let y = 0;

  function ensureSpace(needed: number) {
    if (y + needed > PAGE_H - 20) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function drawHeader() {
    if (photoDataUrl) {
      doc.addImage(photoDataUrl, 0, 0, PAGE_W, HEADER_H);
      doc.setFillColor(0, 0, 0);
      doc.setGState(new (doc as any).GState({ opacity: 0.55 }));
      doc.rect(0, 0, PAGE_W, HEADER_H, "F");
      doc.setGState(new (doc as any).GState({ opacity: 1 }));
    } else {
      doc.setFillColor(...headerRgb);
      doc.rect(0, 0, PAGE_W, HEADER_H, "F");
    }

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(f["Client Name"] || "Client", MARGIN, 12);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(220, 230, 240);
    doc.text("New Client Onboarding Form", MARGIN, 19);

    const generatedDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    doc.text(`Generated ${generatedDate}`, PAGE_W - MARGIN, 19, { align: "right" });

    y = HEADER_H + 8;
  }

  function sectionTitle(title: string) {
    ensureSpace(14);
    doc.setDrawColor(...accentRgb);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, MARGIN + 30, y);
    y += 5;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...accentRgb);
    doc.text(title, MARGIN, y);
    y += 7;
  }

  function fieldRow(label: string, value: string | undefined | null, colWidth?: number) {
    ensureSpace(8);
    const col = colWidth || CONTENT_W / 2;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(label, MARGIN, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(value || "—", MARGIN + col, y);
    y += 5;
  }

  function fieldGrid(rows: [string, string | undefined | null][]) {
    for (let i = 0; i < rows.length; i += 2) {
      ensureSpace(8);
      const halfW = CONTENT_W / 2;
      // Left column
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 116, 139);
      doc.text(rows[i][0], MARGIN, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      const lv = rows[i][1] || "—";
      doc.text(lv.substring(0, 40), MARGIN, y + 4);
      // Right column
      if (rows[i + 1]) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 116, 139);
        doc.text(rows[i + 1][0], MARGIN + halfW, y);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        const rv = rows[i + 1][1] || "—";
        doc.text(rv.substring(0, 40), MARGIN + halfW, y + 4);
      }
      y += 9;
    }
  }

  function checklistTable(title: string, items: CheckItem[], dataKey?: string) {
    ensureSpace(10);
    const rows = items.map((item) => {
      const key = dataKey ? `${dataKey}${item.key}` : item.key;
      const done = !!od[key];
      return [done ? CHECK : CROSS, item.label, item.required ? "Required" : ""];
    });

    const headRgb: RGB = themeColor
      ? (hexToRgb(themeColor).map((v) => Math.min(255, v + 160)) as RGB)
      : [241, 245, 249];
    const headTextRgb: RGB = themeColor
      ? (hexToRgb(themeColor).map((v) => Math.max(0, v - 60)) as RGB)
      : [71, 85, 105];

    autoTable(doc, {
      startY: y,
      head: [["", title, ""]],
      body: rows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
        valign: "middle",
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: headRgb,
        textColor: headTextRgb,
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 8, halign: "center", fontStyle: "bold", textColor: [22, 163, 74] },
        1: { cellWidth: "auto" },
        2: { cellWidth: 18, halign: "right", fontSize: 6, textColor: [220, 38, 38], fontStyle: "bold" },
      },
      didParseCell(data) {
        if (data.section === "body" && data.column.index === 0) {
          const val = String(data.cell.raw);
          if (val === CROSS) {
            data.cell.styles.textColor = [148, 163, 184];
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD THE PDF
  // ══════════════════════════════════════════════════════════════════════════

  drawHeader();

  // ── Client Basics ─────────────────────────────────────
  sectionTitle("Client Basics");

  const serviceLead = (f["Service Lead"] || []).map((id) => teamMemberMap[id] || id).join(", ");
  const producer = (f["Producer"] || []).map((id) => teamMemberMap[id] || id).join(", ");
  const analyst = (f["Analyst"] || []).map((id) => teamMemberMap[id] || id).join(", ");

  fieldGrid([
    ["Client Name", f["Client Name"]],
    ["BOR Date", formatDate(f["BOR Date"]) || "—"],
    ["Primary Service Lead", serviceLead],
    ["Primary Sales Lead (Producer)", producer],
    ["Analyst", analyst],
    ["Renewal Date", formatDate(f["Renewal Date"]) || "—"],
    ["Est. Annual Revenue", f["Revenue"] ? `$${Number(f["Revenue"]).toLocaleString()}` : "—"],
    ["Revenue Eff. Date", od.revenue_eff_date || "—"],
    ["Account Marketing Name", od.marketing_name || "—"],
    ["Parent Account", od.parent_account || "—"],
    ["Ownership Type", od.ownership_type || "—"],
    ["Business Structure", od.business_structure || "—"],
    ["P&C Client?", od.pc_client ? "Yes" : "No"],
    ["Total Employees", od.total_employees || f["Company Size"] || "—"],
    ["Funding Strategy", f["Funding Strategy"] || "—"],
    ["Segment", f["Segment"] || "—"],
    ["Tax ID Number", od.tax_id || "—"],
    ["NAICS Code", od.naics || "—"],
    ["Location", f["Location"] || "—"],
    ["Main Phone", od.main_phone || "—"],
    ["Website", od.website || "—"],
    ["Company Size", f["Company Size"] || "—"],
  ]);

  // ── Client Contacts ─────────────────────────────────
  const contacts: any[] = od.contacts || [];
  if (contacts.length > 0 && contacts.some((c: any) => c.name)) {
    sectionTitle("Client Contacts");
    const contactRows = contacts
      .filter((c: any) => c.name)
      .map((c: any) => [c.name || "—", c.title || "—", c.email || "—", c.phone || "—", c.notes || ""]);

    autoTable(doc, {
      startY: y,
      head: [["Name", "Title", "Email", "Phone", "Notes"]],
      body: contactRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: themeColor
          ? (hexToRgb(themeColor).map((v) => Math.min(255, v + 160)) as RGB)
          : [241, 245, 249],
        textColor: themeColor
          ? (hexToRgb(themeColor).map((v) => Math.max(0, v - 60)) as RGB)
          : [71, 85, 105],
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Eligibility Details ──────────────────────────────
  sectionTitle("Eligibility Details");
  fieldGrid([
    ["Waiting Period", od.waiting_period || "—"],
    ["Number of Benefit Classes", od.benefit_classes || "—"],
    ["Waiting Period Differs by Class?", od.waiting_period_notes || "—"],
    ["Eligibility Same for All Lines?", od.elig_same_all_lines !== false ? "Yes" : "No"],
    ["Spouse/Domestic Partner Coverage", od.spouse_coverage ? "Yes" : "No"],
    ["Dependent Eligibility Age", od.dependent_age || "26"],
    ["Number of Pay Periods", od.pay_periods || "—"],
    ["When Does Coverage End?", od.coverage_end || "—"],
    ["Non-English Speakers?", od.non_english_notes || "—"],
    ["Approximate Turnover", od.turnover || "—"],
    ["Union/Service Contract/Davis-Bacon", od.union_employees ? "Yes" : "No"],
    ["Plan Sponsor Type", od.plan_sponsor_type || "—"],
  ]);

  // ── Plans & Products ─────────────────────────────────
  const plans: any[] = od.plans || [];
  if (plans.length > 0 && plans.some((p: any) => p.plan || p.carrier)) {
    sectionTitle("Plans & Products");
    const planRows = plans
      .filter((p: any) => p.plan || p.carrier)
      .map((p: any) => [
        p.plan || "—",
        p.carrier || "—",
        p.policyNumber || "—",
        p.fundingType || "—",
        p.gaCarrier || "—",
        p.carrierContact || "—",
      ]);

    autoTable(doc, {
      startY: y,
      head: [["Plan Type", "Carrier", "Policy #", "Funding", "GA/Carrier", "Contact"]],
      body: planRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 7,
        cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: themeColor
          ? (hexToRgb(themeColor).map((v) => Math.min(255, v + 160)) as RGB)
          : [241, 245, 249],
        textColor: themeColor
          ? (hexToRgb(themeColor).map((v) => Math.max(0, v - 60)) as RGB)
          : [71, 85, 105],
        fontStyle: "bold",
        fontSize: 6.5,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Enrollment method
    if (od.enrollment_system || od.ben_admin_platform) {
      fieldGrid([
        ["Enrollment System", od.enrollment_system || "—"],
        ["Ben Admin Platform", od.ben_admin_platform || "—"],
      ]);
    }
  }

  // ── OMNI Solutions ───────────────────────────────────
  const omniSelected: string[] = od.omni_selected || [];
  if (omniSelected.length > 0) {
    sectionTitle("OMNI Solutions");
    ensureSpace(10);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);

    // Two-column list
    const halfLen = Math.ceil(omniSelected.length / 2);
    const col1 = omniSelected.slice(0, halfLen);
    const col2 = omniSelected.slice(halfLen);
    const maxLen = Math.max(col1.length, col2.length);

    for (let i = 0; i < maxLen; i++) {
      ensureSpace(5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(22, 163, 74);
      if (col1[i]) {
        doc.text(CHECK, MARGIN, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 41, 59);
        doc.text(col1[i], MARGIN + 5, y);
      }
      if (col2[i]) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(22, 163, 74);
        doc.text(CHECK, MARGIN + CONTENT_W / 2, y);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 41, 59);
        doc.text(col2[i], MARGIN + CONTENT_W / 2 + 5, y);
      }
      y += 4.5;
    }
    y += 3;
  }

  // ── Value Adds ───────────────────────────────────────
  sectionTitle("Value Adds");
  checklistTable("Value Add", VALUE_ADDS, "va_");

  // ── Vendor Information ───────────────────────────────
  sectionTitle("Vendor Information");
  fieldGrid([
    ["COBRA Vendor", od.cobra_vendor || "—"],
    ["SPD / Wrap Vendor", od.spd_wrap_vendor || "—"],
    ["HSA / FSA Vendor", od.hsa_fsa_vendor || "—"],
    ["5500 Vendor", od.vendor_5500 || "—"],
    ["LOA Vendor", od.loa_vendor || "—"],
    ["Payroll Company", od.payroll_company || "—"],
    ["Payroll Cycle", od.payroll_cycle || "—"],
    ["Section 125 / POP Document", od.section_125 ? "Yes" : "No"],
    ["With a PEO?", od.with_peo ? "Yes" : "No"],
    ["PEO Name", od.peo_name_onboard || f["PEO Name"] || "—"],
  ]);
  if (od.with_peo) {
    fieldGrid([
      ["PEO Benefit Carve-out?", od.peo_carveout ? "Yes" : "No"],
      ["Terminating PEO?", od.terminating_peo ? "Yes" : "No"],
    ]);
  }

  // ── Setup Checklist ──────────────────────────────────
  sectionTitle("Setup Checklist");
  checklistTable("Setup Item", SETUP_CHECKLIST);

  // ── Document Checklist ───────────────────────────────
  sectionTitle("Document Checklist");
  checklistTable("Document", DOCUMENT_CHECKLIST);

  // ── Data Request ─────────────────────────────────────
  sectionTitle("Data Request");
  checklistTable("Data Item", DATA_REQUEST_CHECKLIST);

  if (od.data_request_notes) {
    ensureSpace(15);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("Additional Notes:", MARGIN, y);
    y += 4;
    doc.setTextColor(30, 41, 59);
    const noteLines = doc.splitTextToSize(od.data_request_notes, CONTENT_W);
    doc.text(noteLines, MARGIN, y);
    y += noteLines.length * 3.5 + 3;
  }

  // ── Footer on each page ──────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${f["Client Name"]} — New Client Onboarding Form — Page ${i} of ${pageCount}`,
      PAGE_W / 2,
      PAGE_H - 8,
      { align: "center" }
    );
  }

  // ── Save ─────────────────────────────────────────────
  const safeName = (f["Client Name"] || "client").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  doc.save(`${safeName}_onboarding_form.pdf`);
}
