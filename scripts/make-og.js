'use strict';

/**
 * Gera og-investbras.png (1200x630) sem dependencia externa.
 * Redes sociais nao renderizam og:image em SVG, entao o cartao precisa sair
 * como bitmap. A tipografia e uma fonte 5x7 desenhada aqui mesmo, coerente
 * com a leitura de terminal do produto.
 *
 * Uso: node scripts/make-og.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 1200;
const HEIGHT = 630;

const COLORS = {
  bg: [12, 11, 9],
  panel: [19, 18, 16],
  line: [38, 35, 32],
  gold: [216, 175, 88],
  ink: [21, 19, 16],
  text: [244, 240, 230],
  muted: [154, 147, 137],
  up: [111, 191, 138]
};

// Fonte 5x7. Cada glifo e uma coluna de 7 linhas de 5 bits.
const FONT = {
  A: [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  B: [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  D: [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E],
  E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F],
  H: [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
  Q: [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D],
  R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
  S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E],
  T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11],
  X: [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  0: [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  1: [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  2: [0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F],
  3: [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  4: [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  5: [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  6: [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  7: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  9: [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '.': [0, 0, 0, 0, 0, 0x0C, 0x0C],
  '-': [0, 0, 0, 0x1F, 0, 0, 0],
  ',': [0, 0, 0, 0, 0x0C, 0x0C, 0x08]
};

const canvas = Buffer.alloc(WIDTH * HEIGHT * 3);

const setPixel = (x, y, color) => {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 3;
  canvas[offset] = color[0];
  canvas[offset + 1] = color[1];
  canvas[offset + 2] = color[2];
};

const fillRect = (x, y, width, height, color) => {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(column, row, color);
  }
};

const textWidth = (value, scale, tracking) => {
  const step = 5 * scale + tracking;
  return value.length * step - tracking;
};

const drawText = (value, x, y, scale, color, tracking) => {
  const gap = tracking === undefined ? scale : tracking;
  let cursor = x;
  for (const character of String(value).toUpperCase()) {
    const glyph = FONT[character] || FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let bit = 0; bit < 5; bit += 1) {
        if (glyph[row] & (1 << (4 - bit))) {
          fillRect(cursor + bit * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 5 * scale + gap;
  }
  return cursor - gap;
};

/* ------------------------------------------------------------- composicao */

fillRect(0, 0, WIDTH, HEIGHT, COLORS.bg);

// Painel lateral direito com a "cotacao" em destaque geometrico.
fillRect(760, 0, WIDTH - 760, HEIGHT, COLORS.panel);
fillRect(759, 0, 1, HEIGHT, COLORS.line);

// Marca.
fillRect(80, 74, 62, 62, COLORS.gold);
drawText('IB', 89, 91, 4, COLORS.ink, 5);

drawText('INVESTBRAS', 168, 82, 4, COLORS.text, 5);
drawText('INTELLIGENCE', 168, 116, 2, COLORS.gold, 7);

// Titulo em duas linhas.
drawText('CAFE, CAMBIO', 80, 240, 8, COLORS.text, 7);
drawText('E RISCO.', 80, 332, 8, COLORS.gold, 7);

// Linha de apoio.
fillRect(80, 452, 120, 3, COLORS.gold);
drawText('LEITURA DIARIA DE MESA', 80, 490, 3, COLORS.muted, 4);
drawText('COM FONTE DECLARADA EM CADA NUMERO', 80, 526, 3, COLORS.muted, 4);

// Bloco de dado no painel: rotulo, valor grande e linha de tendencia.
drawText('CAFE ARABICA', 810, 150, 3, COLORS.gold, 5);
drawText('ICE NOVA YORK', 810, 186, 2, COLORS.muted, 4);

drawText('KC', 810, 250, 8, COLORS.text, 7);
fillRect(810, 330, 330, 1, COLORS.line);

drawText('EQUIVALENTE', 810, 360, 2, COLORS.muted, 4);
drawText('POR SACA 60KG', 810, 392, 2, COLORS.muted, 4);
drawText('EM REAIS', 810, 440, 5, COLORS.gold, 6);

// Marca grafica abstrata, sem escala, sem numero e sem cor de direcao.
const trend = [0.42, 0.58, 0.36, 0.62, 0.44, 0.70, 0.52, 0.66, 0.58];
const baseY = 560;
const spanY = 70;
for (let index = 0; index < trend.length - 1; index += 1) {
  const x1 = 810 + index * 40;
  const x2 = 810 + (index + 1) * 40;
  const y1 = baseY - Math.round(trend[index] * spanY);
  const y2 = baseY - Math.round(trend[index + 1] * spanY);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / steps);
    const y = Math.round(y1 + ((y2 - y1) * step) / steps);
    fillRect(x, y - 1, 2, 3, COLORS.gold);
  }
}

// Faixa inferior de assinatura.
fillRect(0, HEIGHT - 8, WIDTH, 8, COLORS.gold);

/* -------------------------------------------------------------- encoder PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = buffer => {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;   // profundidade
ihdr[9] = 2;   // RGB
ihdr[10] = 0;  // deflate
ihdr[11] = 0;  // filtro adaptativo
ihdr[12] = 0;  // sem entrelacamento

const raw = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
for (let row = 0; row < HEIGHT; row += 1) {
  const start = row * (WIDTH * 3 + 1);
  raw[start] = 0;
  canvas.copy(raw, start + 1, row * WIDTH * 3, (row + 1) * WIDTH * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const target = path.join(__dirname, '..', 'og-investbras.png');
fs.writeFileSync(target, png);
console.log('og-investbras.png gerado:', WIDTH + 'x' + HEIGHT, (png.length / 1024).toFixed(1) + ' kB');
