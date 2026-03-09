import PDFDocument from 'pdfkit';

interface InvoicePDFData {
  invoiceType: string;
  invoiceNumber: number;
  date: string;
  cae?: string;
  caeExpiration?: string;
  emisor: {
    name: string;
    cuit: string;
    taxCondition: string;
    address: string;
    puntoDeVenta: number;
  };
  receptor: {
    name: string;
    cuit: string;
    taxCondition: string;
    address: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    ivaRate: number;
    subtotal: number;
  }>;
  subtotal: number;
  taxTotal: number;
  total: number;
}

const TAX_CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTISTA: 'Monotributista',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  EXENTO: 'IVA Exento',
};

const INVOICE_TYPE_CODES: Record<string, number> = {
  A: 1,
  B: 6,
  C: 11,
};

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const generateInvoicePDF = (data: InvoicePDFData): PDFKit.PDFDocument => {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const W = 515; // usable width
  const L = 40;  // left margin
  const R = L + W; // right edge
  const MID = L + W / 2;

  let y = 40;

  // ── Top header box ──
  const headerH = 100;
  doc.rect(L, y, W, headerH).stroke();
  // Vertical line in middle
  doc.moveTo(MID, y).lineTo(MID, y + headerH).stroke();

  // Invoice type letter box (centered at top)
  const boxSize = 18;
  const boxX = MID - boxSize / 2;
  const boxY = y + 3;
  doc.rect(boxX, boxY, boxSize, boxSize).fillAndStroke('#000', '#000');
  doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold')
    .text(data.invoiceType, boxX, boxY + 3, { width: boxSize, align: 'center' });
  doc.fillColor('#000');

  // Code below the letter box
  const codTipo = INVOICE_TYPE_CODES[data.invoiceType] || '';
  doc.fontSize(5).font('Helvetica')
    .text(`COD. ${codTipo}`, boxX - 5, boxY + boxSize + 1, { width: boxSize + 10, align: 'center' });

  // LEFT side — Emisor info
  const leftX = L + 10;
  let ly = y + 10;
  doc.fontSize(11).font('Helvetica-Bold').text(data.emisor.name, leftX, ly, { width: MID - L - 30 });
  ly += 16;
  doc.fontSize(8).font('Helvetica');
  doc.text(`Razon Social: ${data.emisor.name}`, leftX, ly, { width: MID - L - 30 });
  ly += 12;
  doc.text(`Domicilio Comercial: ${data.emisor.address}`, leftX, ly, { width: MID - L - 30 });
  ly += 12;
  doc.text(`Condicion frente al IVA: ${TAX_CONDITION_LABELS[data.emisor.taxCondition] || data.emisor.taxCondition}`, leftX, ly, { width: MID - L - 30 });

  // RIGHT side — Invoice details
  const rightX = MID + 10;
  let ry = y + 10;
  const pv = String(data.emisor.puntoDeVenta).padStart(4, '0');
  const num = String(data.invoiceNumber).padStart(8, '0');

  doc.fontSize(10).font('Helvetica-Bold')
    .text(`FACTURA ${data.invoiceType}`, rightX, ry, { width: W / 2 - 20 });
  ry += 14;
  doc.fontSize(8).font('Helvetica');
  doc.text(`Punto de Venta: ${pv}    Comp. Nro: ${num}`, rightX, ry);
  ry += 12;
  doc.text(`Fecha de Emision: ${data.date}`, rightX, ry);
  ry += 14;
  doc.text(`CUIT: ${data.emisor.cuit}`, rightX, ry);
  ry += 12;

  y += headerH + 10;

  // ── Receptor section ──
  const receptorH = 55;
  doc.rect(L, y, W, receptorH).stroke();
  const rx = L + 10;
  let rcy = y + 8;
  doc.fontSize(8).font('Helvetica');
  doc.text(`CUIT: ${data.receptor.cuit}`, rx, rcy);
  doc.text(`Apellido y Nombre / Razon Social: ${data.receptor.name}`, rx + 140, rcy, { width: 300 });
  rcy += 14;
  doc.text(`Condicion frente al IVA: ${TAX_CONDITION_LABELS[data.receptor.taxCondition] || data.receptor.taxCondition}`, rx, rcy);
  rcy += 14;
  doc.text(`Domicilio Comercial: ${data.receptor.address}`, rx, rcy, { width: W - 20 });

  y += receptorH + 10;

  // ── Items table ──
  // Header
  const colDesc = L + 5;
  const colQty = L + 260;
  const colPrice = L + 320;
  const colIva = L + 395;
  const colSub = L + 445;
  const tableHeaderH = 18;

  doc.rect(L, y, W, tableHeaderH).fillAndStroke('#f0f0f0', '#000');
  doc.fillColor('#000').fontSize(7).font('Helvetica-Bold');
  doc.text('Producto / Servicio', colDesc, y + 5);
  doc.text('Cantidad', colQty, y + 5);
  doc.text('Precio Unit.', colPrice, y + 5);
  doc.text('Alicuota IVA', colIva, y + 5);
  doc.text('Subtotal', colSub, y + 5);

  y += tableHeaderH;

  // Items rows
  doc.font('Helvetica').fontSize(8);
  for (const item of data.items) {
    const rowH = 18;
    doc.rect(L, y, W, rowH).stroke();
    doc.text(item.description, colDesc, y + 5, { width: 240 });
    doc.text(String(item.quantity), colQty, y + 5);
    doc.text(`$ ${fmt(item.unitPrice)}`, colPrice, y + 5);
    doc.text(`${item.ivaRate}%`, colIva + 10, y + 5);
    doc.text(`$ ${fmt(item.subtotal)}`, colSub, y + 5);
    y += rowH;
  }

  // Empty space in table
  const emptyH = Math.max(60, 200 - data.items.length * 18);
  doc.rect(L, y, W, emptyH).stroke();
  y += emptyH;

  // ── Totals section ──
  const totalsH = 60;
  doc.rect(L, y, W, totalsH).stroke();
  doc.moveTo(MID, y).lineTo(MID, y + totalsH).stroke();

  const totX = MID + 10;
  let ty = y + 8;
  doc.fontSize(8).font('Helvetica');
  doc.text(`Importe Neto Gravado: $`, totX, ty);
  doc.text(fmt(data.subtotal), R - 80, ty, { width: 70, align: 'right' });
  ty += 12;
  doc.text(`IVA 21%: $`, totX, ty);
  doc.text(fmt(data.taxTotal), R - 80, ty, { width: 70, align: 'right' });
  ty += 14;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Importe Total: $`, totX, ty);
  doc.text(fmt(data.total), R - 80, ty, { width: 70, align: 'right' });

  y += totalsH + 15;

  // ── CAE footer ──
  if (data.cae) {
    doc.rect(L, y, W, 40).stroke();
    doc.fontSize(8).font('Helvetica');
    doc.text(`CAE N°: ${data.cae}`, R - 200, y + 10, { width: 190, align: 'right' });
    if (data.caeExpiration) {
      doc.text(`Fecha de Vto. de CAE: ${data.caeExpiration}`, R - 200, y + 24, { width: 190, align: 'right' });
    }
    doc.fontSize(7).font('Helvetica-Oblique');
    doc.text('Comprobante Autorizado', L + 10, y + 24);
  }

  return doc;
};
