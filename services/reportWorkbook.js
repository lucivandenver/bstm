import JSZip from 'jszip';

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';

export async function sendWorkbook(res, filename, sheets) {
  const zip = new JSZip();
  const sheetFiles = sheets.map((_, i) => `worksheets/sheet${i + 1}.xml`);
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetFiles.map(file => `<Override PartName="/xl/${file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${relationship}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${sheetNamespace}" xmlns:r="${relationship}"><sheets>${sheets.map(({ name }, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${relationships}">${sheetFiles.map((file, i) => `<Relationship Id="rId${i + 1}" Type="${relationship}/worksheet" Target="${file}"/>`).join('')}<Relationship Id="styles" Type="${relationship}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet xmlns="${sheetNamespace}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF007042"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach(({ headers, rows }, i) => {
    const widths = headers.map((header, column) => {
      const width = rows.reduce((max, row) => Math.max(max, String(row[column] ?? '').length + 2), header.length + 4);
      return `<col min="${column + 1}" max="${column + 1}" width="${Math.min(55, width)}" customWidth="1"/>`;
    });
    const body = [headers, ...rows].map((row, index) => `<row r="${index + 1}">${row.map(value =>
      Number.isFinite(value) ? `<c><v>${value}</v></c>` :
        `<c${index === 0 ? ' s="1"' : ''} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`);
    zip.file(`xl/${sheetFiles[i]}`, `<worksheet xmlns="${sheetNamespace}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.join('')}</cols><sheetData>${body.join('')}</sheetData><autoFilter ref="A1:${String.fromCharCode(64 + headers.length)}${rows.length + 1}"/></worksheet>`);
  });
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return res.attachment(filename).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
}
