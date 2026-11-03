import PDFDocument from 'pdfkit';
import { monthRange } from './payroll-engine.js';
import { amountInWords } from '../utils/amount-in-words.js';

export const COMPANY = Object.freeze({
  name: 'Viral Ads Media',
  address: 'B-27, Budh Vihar Phase 1, New Delhi - 110086',
  phone: '+91 93544 91934',
  email: 'hr@viraladsmedia.com',
});

const INK = '#120C0A';
const MUTED = '#6B625C';
const RULE = '#D8D2CE';
const BRAND = '#FF4200';
const SOFT = '#F7F2EF';
const LEFT = 48;
const RIGHT = 547;
const SPLIT = 296;

const rupees = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value) || 0);

export function maskAadhaar(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length <= 4 ? digits : `XXXX XXXX ${digits.slice(-4)}`;
}

export function payslipFilename(payslip) {
  const safe = (value) => String(value ?? '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Payslip_${safe(payslip.snapshot?.name)}_${monthRange(payslip.monthKey).label.replace('/', '-')}.pdf`;
}

function longDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fieldRow(doc, y, label, value, x, width) {
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(`${label}`, x, y, { width: 118, characterSpacing: 0.2 });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(value || '-', x + 122, y - 1.4, { width: Math.max(40, width - 122) });
}

export function renderPayslipPdf(payslip) {
  const doc = new PDFDocument({ size: 'A4', info: { Title: `Salary Slip ${payslip.ref}`, Author: COMPANY.name, Subject: 'Salary Pay Slip' }, autoFirstPage: true });
  const data = payslip.toJSON ? payslip.toJSON() : payslip;

  doc.rect(0, 0, doc.page.width, 7).fill(BRAND);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(COMPANY.name, LEFT, 30);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.8)
    .text(`${COMPANY.address}  |  Tel: ${COMPANY.phone}  |  ${COMPANY.email}`, LEFT, 48, { width: 330 });
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(11).text('SALARY PAYSLIP', LEFT, 30, { width: RIGHT - LEFT, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.4).text(`For the month of ${monthRange(data.monthKey).label}`, LEFT, 45, { width: RIGHT - LEFT, align: 'right' });

  doc.moveTo(LEFT, 64).lineTo(RIGHT, 64).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(`Ref: ${data.ref}`, LEFT, 70, { width: 300 });
  doc.text(`Issue Date: ${longDate(data.issueDate)}`, LEFT, 70, { width: RIGHT - LEFT, align: 'right' });

  const boxTop = 88;
  doc.rect(LEFT, boxTop, RIGHT - LEFT, 128).fillAndStroke(SOFT, RULE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('EMPLOYEE DETAILS', LEFT + 12, boxTop + 10, { characterSpacing: 0.6 });
  const details = [
    ['Employee Name', data.snapshot.name],
    ['Employee ID', data.snapshot.employeeId],
    ['Designation', data.snapshot.designation],
    ['Department', data.snapshot.department],
    ['Date of Joining', data.snapshot.joiningDate ? longDate(data.snapshot.joiningDate) : '-'],
    ['Office', data.snapshot.office],
    ['PAN Number', data.statutory.pan],
    ['Aadhaar Number', maskAadhaar(data.statutory.aadhaar)],
    ['Bank Account', data.statutory.bankAccount],
    ['IFSC Code', data.statutory.ifsc],
  ];
  details.forEach(([label, value], index) => {
    const column = index < 5 ? 0 : 1;
    const row = index % 5;
    const x = LEFT + 12 + column * 250;
    fieldRow(doc, boxTop + 28 + row * 18, `${label}:`, value || '-', x, 240);
  });

  const attendanceTop = boxTop + 136;
  doc.rect(LEFT, attendanceTop, RIGHT - LEFT, 34).fillAndStroke('#FFFFFF', RULE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text('ATTENDANCE', LEFT + 12, attendanceTop + 9, { characterSpacing: 0.6 });
  doc.font('Helvetica').fontSize(8.4).fillColor(MUTED);
  doc.text(`Total Days (NOD): ${data.attendance.totalDays}`, LEFT + 130, attendanceTop + 10, { width: 120 });
  doc.text(`Days Present (NDP): ${data.attendance.paidDays}`, LEFT + 262, attendanceTop + 10, { width: 150 });
  doc.text(`LOP: ${data.attendance.lopDays} Days`, LEFT + 400, attendanceTop + 10, { width: 120 });

  const tableTop = attendanceTop + 54;
  doc.rect(LEFT, tableTop - 20, RIGHT - LEFT, 20).fillAndStroke(INK, INK);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.6);
  doc.text('EARNINGS', LEFT + 12, tableTop - 15, { width: 170 });
  doc.text('AMOUNT (Rs.)', LEFT + 12, tableTop - 15, { width: SPLIT - LEFT - 24, align: 'right' });
  doc.text('DEDUCTIONS', SPLIT + 12, tableTop - 15, { width: 170 });
  doc.text('AMOUNT (Rs.)', SPLIT + 12, tableTop - 15, { width: RIGHT - SPLIT - 24, align: 'right' });

  doc.fillColor(INK).font('Helvetica').fontSize(8.6);
  const rowCount = Math.max(data.earnings.length, data.deductions.length);
  for (let index = 0; index < rowCount; index += 1) {
    const y = tableTop + 4 + index * 19;
    doc.moveTo(LEFT, y - 4).lineTo(RIGHT, y - 4).lineWidth(0.4).strokeColor('#EDE7E3').stroke();
    const earning = data.earnings[index];
    const deduction = data.deductions[index];
    if (earning) {
      doc.fillColor(INK).font('Helvetica').text(earning.label, LEFT + 12, y, { width: 170 });
      doc.fillColor(INK).font('Helvetica-Bold').text(rupees(earning.amount), LEFT + 12, y, { width: SPLIT - LEFT - 24, align: 'right' });
    }
    if (deduction) {
      doc.fillColor(INK).font('Helvetica').text(deduction.label, SPLIT + 12, y, { width: 170 });
      doc.fillColor(INK).font('Helvetica-Bold').text(rupees(deduction.amount), SPLIT + 12, y, { width: RIGHT - SPLIT - 24, align: 'right' });
    }
  }

  const totalsY = tableTop + 8 + rowCount * 19;
  doc.moveTo(LEFT, totalsY).lineTo(RIGHT, totalsY).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.rect(LEFT, totalsY + 2, SPLIT - LEFT - 4, 18).fill('#FFF2EE');
  doc.rect(SPLIT + 4, totalsY + 2, RIGHT - SPLIT - 8, 18).fill(SOFT);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8.6).text('GROSS EARNINGS', LEFT + 10, totalsY + 7, { width: 170 });
  doc.text(rupees(data.grossEarnings), LEFT + 12, totalsY + 7, { width: SPLIT - LEFT - 28, align: 'right' });
  doc.fillColor(INK).text('TOTAL DEDUCTIONS', SPLIT + 12, totalsY + 7, { width: 170 });
  doc.text(rupees(data.totalDeductions), SPLIT + 12, totalsY + 7, { width: RIGHT - SPLIT - 28, align: 'right' });

  const netY = totalsY + 32;
  doc.rect(LEFT, netY, RIGHT - LEFT, 30).fillAndStroke(INK, INK);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10).text('NET TAKE-HOME PAY', LEFT + 14, netY + 10, { width: 200 });
  doc.fontSize(12).text(`Rs. ${rupees(data.netPay)}`, LEFT + 14, netY + 8, { width: RIGHT - LEFT - 28, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(`(${amountInWords(data.netPay, data.currency)})`, LEFT + 14, netY + 38, { width: RIGHT - LEFT });

  const footerY = netY + 66;
  doc.moveTo(LEFT, footerY).lineTo(RIGHT, footerY).lineWidth(0.8).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.6)
    .text('* This is a computer-generated salary slip and does not require a physical signature.', LEFT, footerY + 10, { width: 330 });
  if (data.manual) {
    doc.text('Edited by HR after generation.', LEFT, footerY + 22, { width: 330 });
  }
  const signX = RIGHT - 190;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.6)
    .text(`For ${COMPANY.name}`, signX, footerY + 20, { width: 190, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text('Authorised Signatory', signX, footerY + 46, { width: 190, align: 'right' })
    .text('HR Department', signX, footerY + 58, { width: 190, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.6)
    .text(`Generated on ${longDate(data.generatedAt ?? data.issueDate)}`, LEFT + 340, footerY + 10, { width: 190, align: 'left' });

  doc.end();
  return doc;
}
