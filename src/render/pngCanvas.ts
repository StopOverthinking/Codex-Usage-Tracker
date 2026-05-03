import { deflateSync } from "node:zlib";

type Rgba = readonly [number, number, number, number];
type TextAlign = "left" | "center" | "right";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = buildCrcTable();
const TEXT_PIXEL_GRID = 2;

const FONT: Record<string, readonly string[]> = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  ":": ["000", "010", "010", "000", "010", "010", "000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "11100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"]
};

export class PngCanvas {
  readonly height: number;
  readonly width: number;
  readonly #data: Buffer;

  constructor(width: number, height: number, background: string) {
    this.width = width;
    this.height = height;
    this.#data = Buffer.alloc(width * height * 4);
    this.fill(background);
  }

  fill(color: string): void {
    this.rect(0, 0, this.width, this.height, color);
  }

  rect(x: number, y: number, width: number, height: number, color: string): void {
    const rgba = parseColor(color);
    const x0 = clamp(Math.floor(x), 0, this.width);
    const y0 = clamp(Math.floor(y), 0, this.height);
    const x1 = clamp(Math.ceil(x + width), 0, this.width);
    const y1 = clamp(Math.ceil(y + height), 0, this.height);

    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.#pixel(px, py, rgba);
      }
    }
  }

  roundedRect(x: number, y: number, width: number, height: number, radius: number, color: string): void {
    const rgba = parseColor(color);
    const x0 = clamp(Math.floor(x), 0, this.width);
    const y0 = clamp(Math.floor(y), 0, this.height);
    const x1 = clamp(Math.ceil(x + width), 0, this.width);
    const y1 = clamp(Math.ceil(y + height), 0, this.height);
    const safeRadius = Math.max(0, radius);

    if (isPixelGridAligned(x, y, width, height, safeRadius)) {
      for (let py = y0; py < y1; py += TEXT_PIXEL_GRID) {
        for (let px = x0; px < x1; px += TEXT_PIXEL_GRID) {
          if (roundedRectContainsPoint(px + TEXT_PIXEL_GRID / 2, py + TEXT_PIXEL_GRID / 2, x, y, width, height, safeRadius)) {
            this.#pixelBlock(px, py, TEXT_PIXEL_GRID, rgba);
          }
        }
      }
      return;
    }

    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        if (roundedRectContainsPoint(px + 0.5, py + 0.5, x, y, width, height, safeRadius)) this.#pixel(px, py, rgba);
      }
    }
  }

  text(value: string, x: number, y: number, scale: number, color: string, align: TextAlign = "left"): void {
    const text = value.toUpperCase();
    const safeScale = normalizeTextScale(scale);
    const width = measureText(text, safeScale);
    const alignedX = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    const startX = snapTextPixel(alignedX);
    const startY = snapTextPixel(y);
    const rgba = parseColor(color);
    let cursor = startX;

    for (const rawChar of text) {
      const glyph = FONT[rawChar] ?? FONT["?"];
      if (!glyph) continue;
      drawGlyph(this, glyph, cursor, startY, safeScale, rgba);
      cursor += glyphWidth(glyph) * safeScale + safeScale;
    }
  }

  toDataUri(): string {
    return `data:image/png;base64,${this.toBuffer().toString("base64")}`;
  }

  toBuffer(): Buffer {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      const rawOffset = y * (this.width * 4 + 1);
      raw[rawOffset] = 0;
      this.#data.copy(raw, rawOffset + 1, y * this.width * 4, (y + 1) * this.width * 4);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }

  #pixel(x: number, y: number, color: Rgba): void {
    const offset = (y * this.width + x) * 4;
    this.#data[offset] = color[0];
    this.#data[offset + 1] = color[1];
    this.#data[offset + 2] = color[2];
    this.#data[offset + 3] = color[3];
  }

  #pixelBlock(x: number, y: number, size: number, color: Rgba): void {
    for (let py = y; py < y + size; py += 1) {
      for (let px = x; px < x + size; px += 1) {
        this.#pixel(px, py, color);
      }
    }
  }
}

export function measureText(value: string, scale: number): number {
  const safeScale = normalizeTextScale(scale);
  let width = 0;
  for (const rawChar of value.toUpperCase()) {
    const glyph = FONT[rawChar] ?? FONT["?"];
    if (!glyph) continue;
    width += glyphWidth(glyph) * safeScale + safeScale;
  }
  return Math.max(0, width - safeScale);
}

function drawGlyph(canvas: PngCanvas, glyph: readonly string[], x: number, y: number, scale: number, color: Rgba): void {
  for (let row = 0; row < glyph.length; row += 1) {
    const line = glyph[row] ?? "";
    for (let column = 0; column < line.length; column += 1) {
      if (line[column] === "1") {
        canvas.rect(x + column * scale, y + row * scale, scale, scale, colorToHex(color));
      }
    }
  }
}

function glyphWidth(glyph: readonly string[]): number {
  return glyph[0]?.length ?? 0;
}

function normalizeTextScale(scale: number): number {
  const rounded = Math.max(1, Math.round(scale));
  return Math.max(TEXT_PIXEL_GRID, Math.round(rounded / TEXT_PIXEL_GRID) * TEXT_PIXEL_GRID);
}

function snapTextPixel(value: number): number {
  return Math.round(value / TEXT_PIXEL_GRID) * TEXT_PIXEL_GRID;
}

function isPixelGridAligned(...values: number[]): boolean {
  return values.every((value) => Number.isInteger(value) && value % TEXT_PIXEL_GRID === 0);
}

function roundedRectContainsPoint(
  sampleX: number,
  sampleY: number,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): boolean {
  const left = x + radius;
  const right = x + width - radius;
  const top = y + radius;
  const bottom = y + height - radius;
  const dx = sampleX < left ? left - sampleX : sampleX > right ? sampleX - right : 0;
  const dy = sampleY < top ? top - sampleY : sampleY > bottom ? sampleY - bottom : 0;
  return dx * dx + dy * dy <= radius * radius;
}

function parseColor(color: string): Rgba {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [255, 255, 255, 255];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), 255];
}

function colorToHex(color: Rgba): string {
  return `#${hexByte(color[0])}${hexByte(color[1])}${hexByte(color[2])}`;
}

function hexByte(value: number): string {
  return clamp(value, 0, 255).toString(16).padStart(2, "0");
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
