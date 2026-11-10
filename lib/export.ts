import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Report } from "./reports";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const cellText = (v: any, kind?: string) => {
  if (v == null || v === "") return "";
  if (kind === "money") return inr(v);
  if (kind === "pct") return `${Number(v).toFixed(1)}%`;
  return String(v);
};

export function toCsv(r: Report): string {
  const esc = (s: any) => {
    let t = s == null ? "" : String(s);
    if (/^[=+\-@]/.test(t) && typeof s === "string") t = "'" + t; // neutralise spreadsheet formula injection
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [[r.title], [r.subtitle], [], r.columns.map((c) => c.label), ...r.rows.map((row) => r.columns.map((c) => row[c.key]))];
  return lines.map((l) => l.map(esc).join(",")).join("\r\n");
}

export async function toXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Arshith Group Finance ERP";
  const ws = wb.addWorksheet(r.title.replace(/[\/*?:[\]]/g, "-").slice(0, 30));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { italic: true, color: { argb: "FF637381" } };
  ws.addRow(["All amounts in INR"]).font = { size: 9, color: { argb: "FF919EAB" } };
  ws.addRow([]);
  const h = ws.addRow(r.columns.map((c) => c.label));
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00A76F" } }; });
  for (const row of r.rows) {
    const x = ws.addRow(r.columns.map((c) => (c.kind === "money" || c.kind === "pct" || c.kind === "int" ? (row[c.key] == null ? null : Number(row[c.key])) : row[c.key] ?? "")));
    r.columns.forEach((c, i) => {
      const cell = x.getCell(i + 1);
      if (c.kind === "money") cell.numFmt = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
      if (c.kind === "pct") cell.numFmt = '0.0"%"';
    });
    if (["total", "grand", "sub", "head"].includes(row._style)) x.font = { bold: true };
    if (row._style === "grand") x.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F8F0" } }; });
    if (row._level) x.getCell(1).alignment = { indent: row._level };
  }
  r.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.kind === "money" ? 18 : Math.max(14, Math.min(42, c.label.length + 10)); });
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 0, 34);
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const bufs: Buffer[] = [];
  doc.on("data", (b) => bufs.push(b));
  return new Promise((res) => doc.on("end", () => res(Buffer.concat(bufs))));
}

export async function toPdf(r: Report): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: r.columns.length > 5 ? "landscape" : "portrait", margin: 36, bufferPages: true });
  const done = collect(doc);
  const W = doc.page.width - 72;
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#212B36").text(r.title);
  doc.font("Helvetica").fontSize(9).fillColor("#637381").text(r.subtitle).text("All amounts in INR (Rs.)  ·  Generated " + new Date().toISOString().slice(0, 16).replace("T", " "));
  doc.moveDown(0.6);
  const weights = r.columns.map((c, i) => (i === 0 || c.kind === "text" || !c.kind ? 1.8 : c.kind === "money" ? 1.2 : 0.9));
  const tw = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / tw) * W);
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(36, y, W, 18).fill("#00A76F");
    let x = 36;
    r.columns.forEach((c, i) => { doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8).text(c.label, x + 3, y + 5, { width: widths[i] - 6, align: c.kind === "money" || c.kind === "pct" || c.kind === "int" ? "right" : "left", lineBreak: false }); x += widths[i]; });
    doc.y = y + 20;
  };
  drawHeader();
  for (const row of r.rows) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); drawHeader(); }
    const y = doc.y, bold = ["total", "grand", "sub", "head"].includes(row._style);
    if (row._style === "grand") doc.rect(36, y - 1, W, 14).fill("#E8F8F0");
    let x = 36;
    r.columns.forEach((c, i) => {
      const t = cellText(row[c.key], c.kind);
      doc.fillColor("#212B36").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8)
        .text(t, x + 3 + (i === 0 && row._level ? row._level * 10 : 0), y + 2, { width: widths[i] - 6, align: c.kind === "money" || c.kind === "pct" || c.kind === "int" ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.moveTo(36, y + 13).lineTo(36 + W, y + 13).lineWidth(0.3).strokeColor("#DFE3E8").stroke();
    doc.y = y + 14;
  }
  const n = doc.bufferedPageRange().count;
  for (let i = 0; i < n; i++) { doc.switchToPage(i); doc.page.margins.bottom = 0; doc.fontSize(7).fillColor("#919EAB").text(`Page ${i + 1} of ${n}  ·  Computer generated from posted ledger entries`, 36, doc.page.height - 28, { width: W, align: "center", lineBreak: false }); }
  doc.end();
  return done;
}

// ---------- number to words (Indian system) ----------
const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
const three = (n: number) => (n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "") : two(n));
export function inWords(amount: number): string {
  const rupees = Math.floor(amount), paise = Math.round((amount - rupees) * 100);
  if (!rupees && !paise) return "Zero Rupees Only";
  const parts: string[] = [];
  const cr = Math.floor(rupees / 1e7), lk = Math.floor((rupees % 1e7) / 1e5), th = Math.floor((rupees % 1e5) / 1e3), rest = rupees % 1e3;
  if (cr) parts.push(three(cr) + " Crore"); if (lk) parts.push(two(lk) + " Lakh"); if (th) parts.push(two(th) + " Thousand"); if (rest) parts.push(three(rest));
  return `${parts.join(" ")} Rupees${paise ? " and " + two(paise) + " Paise" : ""} Only`;
}

// ---------- invoice PDF ----------
export async function invoicePdf(inv: any, co: any, cust: any, items: any[], payments: any[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const done = collect(doc);
  const W = doc.page.width - 80, brand = co.brand_color || "#00A76F";
  doc.roundedRect(40, 40, 46, 46, 8).fill(brand);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text(co.logo_text || co.name.slice(0, 2).toUpperCase(), 40, 55, { width: 46, align: "center" });
  doc.fillColor("#212B36").font("Helvetica-Bold").fontSize(15).text(co.legal_name || co.name, 98, 42);
  doc.font("Helvetica").fontSize(8.5).fillColor("#637381").text([co.address, [co.city, co.state, co.pincode].filter(Boolean).join(", "), co.gstin && `GSTIN: ${co.gstin}`, co.pan && `PAN: ${co.pan}`, [co.phone, co.email].filter(Boolean).join("  ·  ")].filter(Boolean).join("\n"), 98, 60, { width: 280 });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(brand).text(co.gst_registered ? "TAX INVOICE" : "INVOICE", 330, 42, { width: W - 290, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#212B36").text(`No: ${inv.invoice_no}\nDate: ${inv.issue_date}\nDue: ${inv.due_date}${inv.status === "voided" ? "\nSTATUS: VOID" : ""}`, 330, 68, { width: W - 290, align: "right" });
  doc.moveTo(40, 120).lineTo(40 + W, 120).strokeColor("#DFE3E8").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#919EAB").text("BILL TO", 40, 130);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#212B36").text(cust.name, 40, 142);
  doc.font("Helvetica").fontSize(8.5).fillColor("#637381").text([cust.address, cust.gstin && `GSTIN: ${cust.gstin}`, cust.email, cust.phone].filter(Boolean).join("\n"), 40, 157, { width: 260 });
  if (inv.project) doc.font("Helvetica").fontSize(8.5).text(`Project / Ref: ${inv.project}\nPlace of supply: ${inv.place_of_supply || "—"}`, 330, 142, { width: W - 290, align: "right" });
  let y = 205;
  const cols = [["#", 22, "left"], ["Description", 190, "left"], ["HSN/SAC", 52, "left"], ["Qty", 34, "right"], ["Rate", 60, "right"], ["Disc.", 48, "right"], ["GST%", 34, "right"], ["Amount", 75, "right"]] as const;
  const scale = W / cols.reduce((s, c) => s + c[1], 0);
  const header = () => { doc.rect(40, y, W, 18).fill(brand); let x = 40; cols.forEach(([l, w, a]) => { doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8).text(l, x + 3, y + 5, { width: w * scale - 6, align: a as any }); x += w * scale; }); y += 20; };
  header();
  items.forEach((it, i) => {
    if (y > 700) { doc.addPage(); y = 40; header(); }
    let x = 40;
    const vals = [String(i + 1), it.description, it.hsn_sac || "", String(+it.quantity), inr(it.unit_price), inr(it.discount), String(+it.gst_rate), inr(it.amount)];
    const h = doc.heightOfString(vals[1], { width: cols[1][1] * scale - 6 }) + 8;
    cols.forEach(([, w, a], k) => { doc.fillColor("#212B36").font("Helvetica").fontSize(8.5).text(vals[k], x + 3, y + 4, { width: w * scale - 6, align: a as any }); x += w * scale; });
    y += Math.max(h, 18);
    doc.moveTo(40, y).lineTo(40 + W, y).lineWidth(0.3).strokeColor("#DFE3E8").stroke();
  });
  y += 10;
  const row = (l: string, v: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 10.5 : 9).fillColor("#212B36").text(l, 330, y, { width: 120 }).text(v, 450, y, { width: W - 410, align: "right" }); y += bold ? 18 : 14; };
  row("Subtotal", inr(inv.subtotal)); if (inv.discount_total > 0) row("Discount", "- " + inr(inv.discount_total));
  if (inv.cgst > 0) row("CGST", inr(inv.cgst)); if (inv.sgst > 0) row("SGST", inr(inv.sgst)); if (inv.igst > 0) row("IGST", inr(inv.igst));
  doc.moveTo(330, y).lineTo(40 + W, y).strokeColor("#212B36").lineWidth(0.6).stroke(); y += 4;
  row("Total (INR)", inr(inv.total), true);
  if (inv.amount_paid > 0) { row("Received", "- " + inr(inv.amount_paid)); row("Balance due", inr(inv.total - inv.amount_paid), true); }
  doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#637381").text("Amount in words: " + inWords(inv.total), 40, y - 30, { width: 270 });
  y = Math.max(y + 10, 640);
  if (payments.length) { doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#212B36").text("Payments received", 40, y); y += 12; payments.filter((p) => p.status === "posted").forEach((p) => { doc.font("Helvetica").fontSize(8).fillColor("#637381").text(`${p.pay_date}  ·  Rs. ${inr(p.amount)}  ·  ${p.method || ""} ${p.reference || ""}`, 40, y); y += 11; }); y += 4; }
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#212B36").text("Payment terms", 40, y); doc.font("Helvetica").fontSize(8).fillColor("#637381").text(inv.terms || co.payment_terms || "", 40, y + 11, { width: 300 });
  if (co.bank_details) doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#212B36").text("Bank details", 360, y).font("Helvetica").fontSize(8).fillColor("#637381").text(co.bank_details, 360, y + 11, { width: W - 320 });
  if (inv.notes) doc.font("Helvetica").fontSize(8).fillColor("#637381").text("Notes: " + inv.notes, 40, y + 48, { width: W });
  doc.page.margins.bottom = 0; doc.fontSize(7.5).fillColor("#919EAB").text("This is a computer generated invoice.", 40, 800, { width: W, align: "center" });
  doc.end();
  return done;
}

export async function payslipPdf(co: any, emp: any, it: any, month: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A5", margin: 36 });
  const done = collect(doc);
  const W = doc.page.width - 72;
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#212B36").text(co.legal_name || co.name);
  doc.font("Helvetica").fontSize(8.5).fillColor("#637381").text([co.address, co.city].filter(Boolean).join(", "));
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12).fillColor(co.brand_color || "#00A76F").text(`PAYSLIP — ${month}`);
  doc.moveDown(0.4).font("Helvetica").fontSize(9).fillColor("#212B36").text(`Employee: ${emp.name} (${emp.emp_code})\nDesignation: ${emp.designation || "—"}    Department: ${emp.department || "—"}\nPAN: ${emp.pan ? "XXXXXX" + String(emp.pan).slice(-4) : "—"}`);
  let y = doc.y + 12;
  const line = (l: string, v: number, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#212B36").text(l, 36, y, { width: 200 }).text("Rs. " + inr(v), 36 + 200, y, { width: W - 200, align: "right" }); y += 16; };
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#919EAB").text("EARNINGS", 36, y); y += 14;
  line("Basic salary", it.basic); line("Allowances", it.allowances); line("Gross earnings", it.basic + it.allowances, true);
  y += 6; doc.font("Helvetica-Bold").fontSize(9).fillColor("#919EAB").text("DEDUCTIONS", 36, y); y += 14;
  line("Statutory / other deductions", it.deductions); line("Advance recovery", it.advance_recovery);
  doc.moveTo(36, y).lineTo(36 + W, y).strokeColor("#212B36").stroke(); y += 6;
  line("NET SALARY", it.net, true);
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#637381").text(inWords(it.net), 36, y + 4, { width: W });
  doc.page.margins.bottom = 0; doc.fontSize(7.5).fillColor("#919EAB").text("Computer generated payslip. Confidential.", 36, doc.page.height - 50, { width: W, align: "center" });
  doc.end();
  return done;
}
