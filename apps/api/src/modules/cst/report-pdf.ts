interface ReportRow {
  label: string;
  count: number;
}

interface ReportDoc {
  title: string;
  subtitle: string;
  columns: [string, string];
  rows: ReportRow[];
  total: number;
}

export function escapeText(s: string): string {
  return s
    .replace(/[\u2013\u2014\u00b7\u2022]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, '?');
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const LINE = 16;
const ROWS_PER_PAGE = Math.floor((PAGE_H - MARGIN * 2 - LINE * 4) / LINE);

function buildPageContent(doc: ReportDoc, pageRows: ReportRow[], pageIndex: number, pageCount: number): string {
  const left = MARGIN;
  const rightCol = PAGE_W - MARGIN - 80;
  let y = PAGE_H - MARGIN;
  const lines: string[] = [];
  const text = (x: number, yy: number, size: number, font: string, s: string) =>
    lines.push(`BT /${font} ${size} Tf ${x} ${yy} Td (${escapeText(s)}) Tj ET`);

  if (pageIndex === 0) {
    text(left, y, 20, 'F2', doc.title);
    y -= LINE * 1.4;
    text(left, y, 10, 'F1', doc.subtitle);
    y -= LINE * 1.6;
  }
  text(left, y, 11, 'F2', doc.columns[0]);
  text(rightCol, y, 11, 'F2', doc.columns[1]);
  y -= LINE;
  lines.push(`${left} ${y + 4} m ${PAGE_W - MARGIN} ${y + 4} l S`);
  y -= 4;
  for (const r of pageRows) {
    text(left, y, 10, 'F1', r.label);
    text(rightCol, y, 10, 'F1', String(r.count));
    y -= LINE;
  }
  if (pageIndex === pageCount - 1) {
    y -= 4;
    lines.push(`${left} ${y + 8} m ${PAGE_W - MARGIN} ${y + 8} l S`);
    text(left, y, 11, 'F2', 'Total');
    text(rightCol, y, 11, 'F2', String(doc.total));
    y -= LINE;
  }
  text(left, MARGIN - 20, 8, 'F1', `Page ${pageIndex + 1} of ${pageCount}`);
  return lines.join('\n');
}

export function renderReportPdf(doc: ReportDoc): Buffer {
  const chunks: ReportRow[][] = [];
  for (let i = 0; i < Math.max(1, doc.rows.length); i += ROWS_PER_PAGE) {
    chunks.push(doc.rows.slice(i, i + ROWS_PER_PAGE));
  }
  const pageCount = chunks.length;
  return assemblePdf(
    chunks.map((rows, p) => ({
      width: PAGE_W,
      height: PAGE_H,
      content: buildPageContent(doc, rows, p, pageCount),
    })),
    ['Helvetica', 'Helvetica-Bold'],
  );
}

export interface PdfPage {
  width: number;
  height: number;
  content: string;
}

export function assemblePdf(pages: readonly PdfPage[], fonts: readonly string[]): Buffer {
  const objects: string[] = [];
  const kidIds: number[] = [];
  const firstFont = 3;
  const contentAndPageStart = firstFont + fonts.length;
  for (let p = 0; p < pages.length; p += 1) {
    kidIds.push(contentAndPageStart + p * 2 + 1);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kidIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  fonts.forEach((name, i) => {
    objects[firstFont + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${name} >>`;
  });
  const fontRefs = fonts.map((_, i) => `/F${i + 1} ${firstFont + i} 0 R`).join(' ');

  pages.forEach((page, p) => {
    const contentId = contentAndPageStart + p * 2;
    const pageId = contentId + 1;
    objects[contentId] = `<< /Length ${Buffer.byteLength(page.content, 'latin1')} >>\nstream\n${page.content}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
      `/Resources << /Font << ${fontRefs} >> >> /Contents ${contentId} 0 R >>`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    if (!objects[i]) continue;
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const count = objects.length;
  pdf += `xref\n0 ${count}\n`;
  pdf += `0000000000 65535 f \n`;
  for (let i = 1; i < count; i += 1) {
    const off = offsets[i] ?? 0;
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
