import jsPDF from "jspdf";
import { format, parseISO, isValid, isWithinInterval, addMonths, endOfMonth, startOfMonth, startOfDay, endOfDay } from "date-fns";

const COMPLIANCE_TYPES = ["IRS", "ERISA", "CMS", "Compliance"];

type CalEvent = {
  id: string;
  date: string;
  title: string;
  client?: string;
  type: string;
  category?: string;
  status?: string;
};

type ClientTheme = {
  themeColor?: string | null;
  headerPhotoUrl?: string | null;
  headerPhotoSource?: string | null;
  clientId?: string | null;
};

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

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export async function exportCalendarPDF(events: CalEvent[], clientName: string | null, theme?: ClientTheme) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });

  const PAGE_W = 215.9;
  const PAGE_H = 279.4;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H = 52;

  const VIOLET = [109, 40, 217] as [number, number, number];
  const SKY    = [14, 165, 233] as [number, number, number];
  const AMBER  = [245, 158, 11] as [number, number, number];
  const SLATE  = [71, 85, 105] as [number, number, number];
  const LIGHT  = [241, 245, 249] as [number, number, number];

  // ── Theme ──────────────────────────────────────────────
  const themeColor = theme?.themeColor || null;
  const headerRgb: [number, number, number] = themeColor ? hexToRgb(themeColor) : SLATE;
  const accentRgb = headerRgb; // used for month headers + sidebar

  const photoUrl = theme?.headerPhotoUrl
    ? (theme.headerPhotoSource === "upload" ? `/api/clients/${theme.clientId}/header-photo` : theme.headerPhotoUrl)
    : null;
  const PX_PER_MM = 3.7795;
  const photoDataUrl = photoUrl
    ? await fetchCroppedImageDataUrl(photoUrl, Math.round(PAGE_W * PX_PER_MM), Math.round(HEADER_H * PX_PER_MM))
    : null;

  const today = new Date();
  const startMonth = startOfMonth(today);

  const months: { label: string; start: Date; end: Date; events: CalEvent[] }[] = [];
  for (let i = 0; i < 12; i++) {
    const ms = addMonths(startMonth, i);
    const me = endOfMonth(ms);
    const monthEvents = events
      .filter((e) => {
        try {
          const d = parseISO(e.date);
          return isValid(d) && isWithinInterval(d, { start: startOfDay(ms), end: endOfDay(me) });
        } catch { return false; }
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    months.push({ label: format(ms, "MMMM yyyy"), start: ms, end: me, events: monthEvents });
  }

  let y = MARGIN;

  function checkPage(needed: number) {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }

  // ── Cover header ────────────────────────────────────────
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

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Compliance Calendar", MARGIN, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(clientName ? `Client: ${clientName}` : "All Clients", MARGIN, 34);
  doc.setFontSize(9);
  doc.text(
    `${format(today, "MMMM yyyy")} – ${format(addMonths(today, 11), "MMMM yyyy")}  ·  Generated ${format(today, "MMMM d, yyyy")}`,
    MARGIN, 43
  );

  y = 62;

  // ── Summary stat boxes ───────────────────────────────────
  const totalEvents = months.reduce((s, m) => s + m.events.length, 0);
  const complianceCount = months.reduce((s, m) => s + m.events.filter((e) => e.type === "deliverable" && COMPLIANCE_TYPES.includes(e.category || "")).length, 0);
  const delivCount = months.reduce((s, m) => s + m.events.filter((e) => e.type === "deliverable").length, 0);
  const openCount = months.reduce((s, m) => s + m.events.filter((e) => e.type === "open-item").length, 0);

  const stats = [
    { label: "Total Events", val: String(totalEvents), color: SLATE },
    { label: "Compliance",   val: String(complianceCount), color: VIOLET },
    { label: "Deliverables", val: String(delivCount), color: SKY },
    { label: "Open Items",   val: String(openCount), color: AMBER },
  ];

  const boxW = (CONTENT_W - 9) / 4;
  stats.forEach((s, i) => {
    const bx = MARGIN + i * (boxW + 3);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(bx, y, boxW, 18, 2, 2, "F");
    doc.setTextColor(...s.color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(s.val, bx + boxW / 2, y + 10, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...SLATE);
    doc.text(s.label, bx + boxW / 2, y + 15.5, { align: "center" });
  });

  y += 26;

  // ── Legend ───────────────────────────────────────────────
  const legend = [
    { color: VIOLET, label: "Compliance Deadline" },
    { color: SKY,    label: "Deliverable" },
    { color: AMBER,  label: "Open Item" },
  ];
  legend.forEach((l, i) => {
    const lx = MARGIN + i * 58;
    doc.setFillColor(...l.color);
    doc.rect(lx, y, 3, 3, "F");
    doc.setTextColor(...SLATE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(l.label, lx + 5, y + 2.5);
  });

  y += 10;

  // ── Month sections ───────────────────────────────────────
  months.forEach((month) => {
    checkPage(16);

    doc.setFillColor(...accentRgb);
    doc.rect(MARGIN - 4, y, CONTENT_W + 8, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(month.label, MARGIN, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`${month.events.length} event${month.events.length !== 1 ? "s" : ""}`, MARGIN + CONTENT_W + 4, y + 6, { align: "right" });

    y += 11;

    if (month.events.length === 0) {
      checkPage(8);
      doc.setTextColor(148, 163, 184);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.text("No events this month", MARGIN + 2, y + 4);
      y += 9;
      return;
    }

    month.events.forEach((e) => {
      checkPage(12);

      const eventColor: [number, number, number] =
        e.type === "deliverable"
          ? COMPLIANCE_TYPES.includes(e.category || "") ? VIOLET : SKY
          : AMBER;

      doc.setFillColor(...eventColor);
      doc.rect(MARGIN - 4, y, 2.5, 10, "F");

      const d = parseISO(e.date);
      doc.setFillColor(...LIGHT);
      doc.rect(MARGIN, y, 18, 10, "F");
      doc.setTextColor(...eventColor);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(format(d, "d"), MARGIN + 9, y + 6.5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...SLATE);
      doc.text(format(d, "EEE").toUpperCase(), MARGIN + 9, y + 9.5, { align: "center" });

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 41, 59);
      const titleLines = doc.splitTextToSize(e.title, CONTENT_W - 60) as string[];
      doc.text(titleLines[0], MARGIN + 22, y + 5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...SLATE);
      const meta = [e.client, e.category, e.status].filter(Boolean).join("  ·  ");
      if (meta) doc.text(meta, MARGIN + 22, y + 9);

      y += 11;
    });

    y += 3;
  });

  // ── Footer ───────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setTextColor(148, 163, 184);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      `Page ${i} of ${pageCount}  ·  Compliance Calendar  ·  ${clientName || "All Clients"}`,
      PAGE_W / 2, PAGE_H - 6, { align: "center" }
    );
  }

  const filename = clientName
    ? `compliance-calendar-${clientName.replace(/\s+/g, "-").toLowerCase()}.pdf`
    : "compliance-calendar-all-clients.pdf";

  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

