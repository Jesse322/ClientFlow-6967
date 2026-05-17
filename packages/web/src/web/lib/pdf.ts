/**
 * PDF generation for client open items report.
 * Uses jsPDF + jspdf-autotable.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { parseNotes } from "@/components/notes-log";
import { formatDate } from "@/lib/utils";
import type { AirtableRecord, Client, OpenItem } from "@/lib/types";

// Parse a hex color string to [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean.length === 3
    ? clean.split("").map(c => c + c).join("")
    : clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Fetch image and crop to exact dimensions using canvas (object-cover behavior)
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
        // Cover: scale so the image fills the target, then center-crop
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

export async function downloadOpenItemsPDF(
  client: AirtableRecord<Client>,
  openItems: AirtableRecord<OpenItem>[],
  teamMemberMap: Record<string, string>,
  options?: { includeNotes?: boolean }
) {
  const includeNotes = options?.includeNotes !== false; // default true
  const f = client.fields;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });

  const PAGE_W = 215.9;
  const MARGIN = 14;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H = 28;

  // ── Theme values ─────────────────────────────────────────
  const themeColor = f["Theme Color"] || null;
  const photoUrl = f["Header Photo URL"]
    ? (f["Header Photo Source"] === "upload"
        ? `/api/clients/${client.id}/header-photo`
        : f["Header Photo URL"])
    : null;

  // Fetch photo if available
  // Convert mm to px at 96dpi for canvas crop (PAGE_W mm → px)
  const PX_PER_MM = 3.7795;
  const photoDataUrl = photoUrl
    ? await fetchCroppedImageDataUrl(photoUrl, Math.round(PAGE_W * PX_PER_MM), Math.round(HEADER_H * PX_PER_MM))
    : null;

  // Header background color — use theme color or default slate-900
  const headerRgb: [number, number, number] = themeColor ? hexToRgb(themeColor) : [15, 23, 42];

  // ── Header ──────────────────────────────────────────────
  if (photoDataUrl) {
    // Draw photo as header background
    doc.addImage(photoDataUrl, 0, 0, PAGE_W, HEADER_H);
    // Dark overlay for readability
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
  doc.text("Open Items Report", MARGIN, 19);

  const generatedDate = new Date().toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  doc.text(`Generated ${generatedDate}`, PAGE_W - MARGIN, 19, { align: "right" });

  // ── Client summary row ───────────────────────────────────
  let y = 36;
  const summaryItems = [
    ["Renewal Date", formatDate(f["Renewal Date"]) || "—"],
    ["Funding Strategy", f["Funding Strategy"] === "PEO" && f["PEO Name"]
      ? `PEO — ${f["PEO Name"]}`
      : f["Funding Strategy"] === "Self Funded" && f["SF Arrangement"]
        ? `Self Funded — ${f["SF Arrangement"]}`
        : f["Funding Strategy"] as string || "—"],
    ["Segment", f["Segment"] as string || "—"],
    ["Company Size", f["Company Size"] ? `${f["Company Size"]} employees` : "—"],
  ];

  doc.setFontSize(7.5);
  const colW = CONTENT_W / summaryItems.length;
  summaryItems.forEach(([label, value], i) => {
    const x = MARGIN + i * colW;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text(value, x, y + 5);
  });

  y += 14;

  // ── Section title ────────────────────────────────────────
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 23, 42);
  doc.text(`Open Items (${openItems.length})`, MARGIN, y);
  y += 6;

  // ── Accent color for table head ─────────────────────────
  // Slightly lighten the header color for table headings
  const tableHeadRgb: [number, number, number] = themeColor
    ? hexToRgb(themeColor).map(v => Math.min(255, v + 160)) as [number, number, number]
    : [241, 245, 249];
  const tableHeadTextRgb: [number, number, number] = themeColor
    ? hexToRgb(themeColor).map(v => Math.max(0, v - 60)) as [number, number, number]
    : [71, 85, 105];

  if (openItems.length === 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 116, 139);
    doc.text("No open items for this client.", MARGIN, y);
  } else {
    const tableHead = includeNotes
      ? [["Item", "Status", "Type", "Due Date", "Assigned To", "Notes / Log"]]
      : [["Item", "Status", "Type", "Due Date", "Assigned To"]];

    const tableRows = openItems.map((oi) => {
      const of_ = oi.fields;
      const assignedIds: string[] = Array.isArray(of_["Assigned To"]) ? of_["Assigned To"] as string[] : [];
      const assignedNames = assignedIds.map(id => teamMemberMap[id] || id).join(", ") || "—";
      const row = [
        of_["Open Item Name"] || "—",
        of_["Status"] || "—",
        of_["Open Item Type"] || "—",
        formatDate(of_["Due Date"] as string | undefined) || "—",
        assignedNames,
      ];
      if (includeNotes) {
        const notes = parseNotes(of_["Notes"] as string | undefined);
        const notesText = notes.length > 0
          ? notes.map(n => n.timestamp ? `[${n.timestamp}] ${n.text}` : n.text).join("\n")
          : "—";
        row.push(notesText);
      }
      return row;
    });

    const columnStyles: Record<number, any> = includeNotes
      ? {
          0: { cellWidth: 38, fontStyle: "bold" },
          1: { cellWidth: 22 },
          2: { cellWidth: 22 },
          3: { cellWidth: 22 },
          4: { cellWidth: 28 },
          5: { cellWidth: "auto" },
        }
      : {
          0: { cellWidth: 50, fontStyle: "bold" },
          1: { cellWidth: 30 },
          2: { cellWidth: 30 },
          3: { cellWidth: 30 },
          4: { cellWidth: "auto" },
        };

    autoTable(doc, {
      startY: y,
      head: tableHead,
      body: tableRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
        valign: "top",
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: tableHeadRgb,
        textColor: tableHeadTextRgb,
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles,
      didParseCell(data) {
        if (data.section === "body" && data.column.index === 1) {
          const val = String(data.cell.raw || "").toLowerCase();
          if (val.includes("complete") || val.includes("done")) {
            data.cell.styles.textColor = [22, 163, 74];
          } else if (val.includes("blocked") || val.includes("overdue")) {
            data.cell.styles.textColor = [220, 38, 38];
          } else if (val.includes("progress") || val.includes("review")) {
            data.cell.styles.textColor = [37, 99, 235];
          } else if (val.includes("pending") || val.includes("open")) {
            data.cell.styles.textColor = [161, 98, 7];
          }
        }
      },
    });
  }

  // ── Footer on each page ──────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${f["Client Name"]} — Open Items Report — Page ${i} of ${pageCount}`,
      PAGE_W / 2,
      279,
      { align: "center" }
    );
  }

  // ── Save ─────────────────────────────────────────────────
  const safeName = (f["Client Name"] || "client").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  doc.save(`${safeName}_open_items.pdf`);
}
