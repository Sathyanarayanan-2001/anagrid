// Fixture files are generated in code, so no binary file and no real document is committed.
import { deflateRawSync, deflateSync } from 'node:zlib';

/** Minimal ZIP writer (stored or deflated entries). */
export function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, n >> 8], u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text, method] of files) {
    const raw = enc.encode(text), data = method === 8 ? deflateRawSync(raw) : raw, nm = enc.encode(name);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...nm];
    parts.push(Uint8Array.from(local), data);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nm]));
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const P = (t, extra = '') => '<w:p>' + extra + '<w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
const NUM = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>';
export const DOCX_XML = '<?xml version="1.0"?><w:document ' + W + '><w:body>' +
  P('Article 1.') + P('The unit shall stay connected at 47.5 Hz &amp; above.', NUM) + P('Second point.', NUM) +
  '<w:p><w:r><w:t>See curve</w:t></w:r><w:r><w:drawing><wp:inline/></w:drawing></w:r><w:del><w:r><w:t>deleted words</w:t></w:r></w:del></w:p>' +
  '<w:tbl><w:tr><w:tc>' + P('Range') + '</w:tc><w:tc>' + P('Time') + '</w:tc></w:tr><w:tr><w:tc>' + P('47.5 Hz – 48.5 Hz') + '</w:tc><w:tc>' + P('30 min') + P('minimum') + '</w:tc></w:tr></w:tbl>' +
  '</w:body></w:document>';
export const DOCX_NUMBERING = '<w:numbering ' + W + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%1)"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
export const DOCX_TEXT = 'Article 1.\n\n(1) The unit shall stay connected at 47.5 Hz & above.\n\n(2) Second point.\n\nSee curve []\n\nRange | Time\n47.5 Hz – 48.5 Hz | 30 min minimum\n';
export const makeDocx = (method = 8) => zip([['[Content_Types].xml', '<Types/>', method], ['word/document.xml', DOCX_XML, method], ['word/numbering.xml', DOCX_NUMBERING, method]]);

/**
 * Two-page PDF. Page 1: a standard font with Tj, TJ kerning and a literal string escape.
 * Page 2: a composite font whose text is only recoverable through its ToUnicode map
 * (as in most real grid code PDFs), in a Flate-compressed content stream.
 */
export function makePdf() {
  const bin = (s) => Buffer.from(s, 'latin1');
  const stream = (dict, body) => Buffer.concat([bin('<< ' + dict + ' /Length ' + body.length + ' >>\nstream\n'), body, bin('\nendstream')]);
  const p1 = bin('BT /F1 12 Tf 72 720 Td (Article 1.) Tj 0 -28 Td [(The unit shall re) -20 (main connected at 47.5 Hz)] TJ 0 -14 Td (for at least 30 minutes \\(measured\\).) Tj ET');
  const cmap = bin('/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange\n3 beginbfchar\n<0001> <010C>\n<0002> <006C>\n<0003> <0061>\nendbfchar\n1 beginbfrange\n<0004> <0005> [<006E> <006B>]\nendbfrange\n2 beginbfchar\n<0006> <0020>\n<0007> <0032>\nendbfchar\nendcmap end end');
  // Codes spell "Članak 2": 1=Č 2=l 3=a 4=n 3=a 5=k 6=space 7=2
  const p2 = deflateSync(bin('BT /F2 12 Tf 72 720 Td <00010002000300040003000500060007> Tj ET'));
  const objs = [
    bin('<< /Type /Catalog /Pages 2 0 R >>'),
    bin('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 /MediaBox [0 0 595 842] >>'),
    bin('<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    stream('', p1),
    bin('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    bin('<< /Type /Page /Parent 2 0 R /Contents 7 0 R /Resources << /Font << /F2 8 0 R >> >> >>'),
    stream('/Filter /FlateDecode', p2),
    bin('<< /Type /Font /Subtype /Type0 /BaseFont /Made-Up /Encoding /Identity-H /DescendantFonts [9 0 R] /ToUnicode 10 0 R >>'),
    bin('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Made-Up /DW 600 >>'),
    stream('', cmap),
  ];
  const parts = [bin('%PDF-1.5\n')]; const offsets = []; let pos = parts[0].length;
  objs.forEach((o, i) => { const b = Buffer.concat([bin((i + 1) + ' 0 obj\n'), o, bin('\nendobj\n')]); offsets.push(pos); parts.push(b); pos += b.length; });
  let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
  parts.push(bin(xref + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + pos + '\n%%EOF\n'));
  return new Uint8Array(Buffer.concat(parts));
}
export const PDF_TEXT = 'Article 1.\n\nThe unit shall remain connected at 47.5 Hz\nfor at least 30 minutes (measured).\n\fČlanak 2\n';
