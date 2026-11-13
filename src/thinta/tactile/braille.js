// Built-in braille for Thinta tactile labels. liblouis was a no-go (multi-MB emscripten build, too heavy
// for the phone bundle), so this is an uncontracted (Grade 1) UEB-style table: letters, digits via the
// number sign, and the few symbols coordinates and simple equations need.
// BETA: maths here is NOT full Nemeth or UEB technical notation. Every sheet says "check with a transcriber".

const LETTERS = '⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵'; // a..z
const DIGITS = '⠚⠁⠃⠉⠙⠑⠋⠛⠓⠊'; // 0..9 are the letters j, a..i after a number sign
export const NUMBER_SIGN = '⠼';
export const CAPITAL = '⠠';
const GRADE1 = '⠰'; // letter a-j straight after a number would read as a digit

const SYMBOLS = {
  ' ': '⠀', ',': '⠂', '.': '⠲', ':': '⠒', ';': '⠆', '?': '⠦', '!': '⠖', "'": '⠄',
  '(': '⠐⠣', ')': '⠐⠜', '=': '⠐⠶', '+': '⠐⠖', '×': '⠐⠦', '*': '⠐⠦', '/': '⠸⠌', '÷': '⠐⠌',
  '<': '⠈⠣', '>': '⠈⠜', '^': '⠔', '%': '⠨⠴',
};
const MINUS = '⠐⠤';
const HYPHEN = '⠤';
const SUPERSCRIPTS = { '²': '2', '³': '3' };

const isDigit = ch => ch >= '0' && ch <= '9';
const isLetter = ch => /[a-z]/i.test(ch || '');

// Text to Unicode braille cells (U+2800 block). Unknown characters are dropped rather than guessed.
export function toBraille(text) {
  const s = String(text ?? '');
  let out = '';
  let numeric = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isDigit(ch)) {
      if (!numeric) out += NUMBER_SIGN;
      out += DIGITS[+ch];
      numeric = true;
      continue;
    }
    // A decimal point keeps the number going only when a digit follows (1.5), otherwise it is a full stop.
    if (ch === '.' && numeric && isDigit(s[i + 1])) { out += '⠲'; continue; }
    if (SUPERSCRIPTS[ch]) { out += '⠔' + NUMBER_SIGN + DIGITS[+SUPERSCRIPTS[ch]]; numeric = true; continue; }
    const wasNumeric = numeric;
    numeric = false;
    if (isLetter(ch)) {
      const lower = ch.toLowerCase();
      const idx = lower.charCodeAt(0) - 97;
      if (ch !== lower) out += CAPITAL;
      else if (wasNumeric && idx < 10) out += GRADE1;
      out += LETTERS[idx];
      continue;
    }
    // Hyphen only inside a word (well-known); everywhere else a dash is a minus sign.
    if (ch === '-' || ch === '−' || ch === '–') { out += ch !== '−' && isLetter(s[i - 1]) && isLetter(s[i + 1]) ? HYPHEN : MINUS; continue; }
    if (SYMBOLS[ch]) out += SYMBOLS[ch];
  }
  return out;
}

// Dot numbers (1-6) raised in one braille cell.
export function cellDots(cell) {
  const bits = cell.codePointAt(0) - 0x2800;
  const dots = [];
  for (let d = 0; d < 6; d++) if (bits & (1 << d)) dots.push(d + 1);
  return dots;
}

// Standard swell-paper braille geometry in mm (dot 1.5 mm, 2.5 mm within a cell, 6 mm cell to cell).
export const BRAILLE = { dotR: 0.75, dotPitch: 2.5, cellPitch: 6, cellW: 4, cellH: 6.5 };

export const brailleWidth = cells => (cells.length ? (cells.length - 1) * BRAILLE.cellPitch + BRAILLE.cellW : 0);

// Dot centres for a braille string whose cell box starts at (x, y).
export function brailleDots(cells, x, y) {
  const pts = [];
  [...cells].forEach((cell, i) => {
    for (const d of cellDots(cell)) {
      const col = d > 3 ? 1 : 0, row = (d - 1) % 3;
      pts.push({ x: x + BRAILLE.dotR + i * BRAILLE.cellPitch + col * BRAILLE.dotPitch, y: y + BRAILLE.dotR + row * BRAILLE.dotPitch });
    }
  });
  return pts;
}
