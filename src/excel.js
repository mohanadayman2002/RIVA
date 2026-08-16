/**
 * Excel export of everything the bot has collected.
 *
 * Two sheets, joined on the presentation id:
 *   Submissions — one row per presentation: phone number, text, counts, link
 *   Images      — one row per uploaded file, carrying the phone number too
 *
 * The workbook is rebuilt from the store on every new submission, so the file on
 * disk is always current, and /export.xlsx serves a freshly built copy.
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { config } from './config.js';
import { listPresentations } from './store.js';

export const workbookPath = path.join(config.dataDir, 'presentations.xlsx');

/**
 * A WhatsApp id is the sender's number in international form. Simulator and demo
 * ids are not numbers, so they are recorded as they are rather than given a "+".
 */
export const formatPhone = (waId) => (/^\d{6,15}$/.test(String(waId)) ? `+${waId}` : String(waId));

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.font = HEADER_FONT;
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
}

const mediaLink = (rel) => `${config.baseUrl}/media/${rel.split('/').map(encodeURIComponent).join('/')}`;

export function buildWorkbook(presentations) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = config.brand.name || 'WhatsApp presentation bot';
  workbook.created = new Date();

  // ---------------------------------------------------------- submissions
  const submissions = workbook.addWorksheet('Submissions');
  submissions.columns = [
    { header: 'Presentation ID', key: 'id', width: 16 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Time', key: 'time', width: 10 },
    { header: 'Phone number', key: 'phone', width: 18 },
    { header: 'WhatsApp name', key: 'name', width: 20 },
    { header: 'Text', key: 'text', width: 60 },
    { header: 'Photos', key: 'photos', width: 9 },
    { header: 'Floor plans', key: 'plans', width: 12 },
    { header: 'Presentation link', key: 'link', width: 44 },
    { header: 'Views', key: 'views', width: 8 },
  ];

  for (const p of presentations) {
    const created = new Date(p.createdAt);
    const row = submissions.addRow({
      id: p.id,
      date: created,
      time: created,
      phone: p.phone || formatPhone(p.waId || ''),
      name: p.profileName || '',
      text: p.text || '',
      photos: (p.images || []).length,
      plans: (p.floorplans || []).length,
      link: `${config.baseUrl}/p/${p.id}`,
      views: p.views || 0,
    });

    row.getCell('date').numFmt = 'yyyy-mm-dd';
    row.getCell('time').numFmt = 'hh:mm';
    row.getCell('text').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('link').value = { text: `${config.baseUrl}/p/${p.id}`, hyperlink: `${config.baseUrl}/p/${p.id}` };
    row.getCell('link').font = { color: { argb: 'FF0563C1' }, underline: true };
    row.alignment = { vertical: 'top' };
  }
  styleHeader(submissions);

  // ---------------------------------------------------------- images
  const images = workbook.addWorksheet('Images');
  images.columns = [
    { header: 'Presentation ID', key: 'id', width: 16 },
    { header: 'Phone number', key: 'phone', width: 18 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Kind', key: 'kind', width: 12 },
    { header: '#', key: 'index', width: 5 },
    { header: 'File', key: 'file', width: 34 },
    { header: 'Image link', key: 'link', width: 56 },
  ];

  for (const p of presentations) {
    const created = new Date(p.createdAt);
    const phone = p.phone || formatPhone(p.waId || '');

    const push = (rel, kind, index) => {
      const url = mediaLink(rel);
      const row = images.addRow({
        id: p.id,
        phone,
        date: created,
        kind,
        index,
        file: rel.split('/').pop(),
        link: url,
      });
      row.getCell('date').numFmt = 'yyyy-mm-dd';
      row.getCell('link').value = { text: url, hyperlink: url };
      row.getCell('link').font = { color: { argb: 'FF0563C1' }, underline: true };
    };

    (p.images || []).forEach((rel, i) => push(rel, 'Photo', i + 1));
    (p.floorplans || []).forEach((rel, i) => push(rel, 'Floor plan', i + 1));
  }
  styleHeader(images);

  return workbook;
}

/** Rebuilds the workbook from the store and writes it to data/presentations.xlsx. */
export async function writeWorkbook() {
  const workbook = buildWorkbook(await listPresentations(100000));
  await workbook.xlsx.writeFile(workbookPath);
  return workbookPath;
}

/** Same workbook, as a buffer — used by the /export.xlsx download. */
export async function workbookBuffer() {
  const workbook = buildWorkbook(await listPresentations(100000));
  return workbook.xlsx.writeBuffer();
}
