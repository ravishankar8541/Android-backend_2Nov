const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand'], [100, 'Hundred']];

function belowHundred(value) {
  if (value < 20) return ONES[value];
  const ten = Math.floor(value / 10);
  const one = value % 10;
  return `${TENS[ten]}${one ? ` ${ONES[one]}` : ''}`;
}

function belowThousand(value) {
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  return [hundred ? `${ONES[hundred]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

function indianGroup(value) {
  const parts = [];
  for (const [scale, name] of SCALES) {
    const count = Math.floor(value / scale);
    if (!count) continue;
    value -= count * scale;
    // Sub-scale counts reuse the same grouping, so "Two Crore Forty Lakh" never needs an "and".
    parts.push(scale === 100 ? `${ONES[count]} Hundred` : `${indianGroup(count)} ${name}`);
  }
  if (value) parts.push(belowHundred(value));
  return parts.filter(Boolean).join(' ');
}

export function amountInWords(amount, currency = 'INR') {
  const unit = currency === 'INR' ? 'Rupees' : currency;
  const negative = Number(amount) < 0;
  const whole = Math.abs(Math.round(Number(amount) || 0));
  return `${negative ? 'Minus ' : ''}${unit} ${whole ? indianGroup(whole) : 'Zero'} Only`;
}
