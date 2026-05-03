import { inflateSync } from "node:zlib";
import { build } from "esbuild";

const COLORS = {
  blue: [0x33, 0x9c, 0xff, 0xff],
  green: [0x34, 0xd6, 0x6f, 0xff],
  orange: [0xff, 0x5a, 0x1f, 0xff],
  text: [0xff, 0xff, 0xff, 0xff]
};

const USAGE_ROW = {
  session: { x: 18, y: 72, width: 108, height: 8, color: COLORS.blue },
  weekly: { x: 18, y: 126, width: 108, height: 8, color: COLORS.green }
};

const renderer = await loadRenderer();
const failures = [];
const remainingPercents = [0, 1, 5, 35, 62, 84, 99, 100];

for (const percent of remainingPercents) {
  const image = decodePng(renderUsage(percent, percent));
  assertHeaderBar(image, percent <= 35 ? COLORS.orange : COLORS.blue, `usage ${percent}%`);
  assertMeter(image, USAGE_ROW.session, percent, `5H ${percent}%`);
  assertMeter(image, USAGE_ROW.weekly, percent, `1W ${percent}%`);
}

const detailsImage = decodePng(renderUsage(84, 62, "details"));
assertHeaderBar(detailsImage, COLORS.blue, "details");

if (failures.length > 0) {
  throw new Error(`Render integrity failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

console.log(`Render integrity passed for ${remainingPercents.length} usage samples and the details view.`);

async function loadRenderer() {
  const bundle = await build({
    bundle: true,
    entryPoints: ["src/render/keyPng.ts"],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    write: false
  });
  const output = bundle.outputFiles[0]?.text;
  if (!output) throw new Error("Renderer bundle was empty.");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function renderUsage(sessionRemaining, weeklyRemaining, screenMode = "usage") {
  return renderer.renderUsagePngDataUri({
    screenMode,
    result: {
      status: "ok",
      snapshot: {
        stale: false,
        selected: {
          planType: "pro",
          limitName: null,
          limitId: null,
          primary: usageWindow(sessionRemaining),
          secondary: usageWindow(weeklyRemaining)
        }
      }
    }
  });
}

function usageWindow(remainingPercent) {
  return {
    resetsAt: 1893456000,
    usedPercent: 100 - remainingPercent
  };
}

function assertHeaderBar(image, expectedColor, label) {
  for (let y = 28; y < 32; y += 1) {
    for (let x = 52; x < 92; x += 1) {
      if (!sameColor(image.pixel(x, y), expectedColor)) {
        failures.push(`${label}: header bar pixel ${x},${y} was ${formatColor(image.pixel(x, y))}, expected ${formatColor(expectedColor)}`);
        return;
      }
    }
  }
}

function assertMeter(image, row, percent, label) {
  const trackY = row.y + Math.floor(row.height / 2);

  if (percent <= 0) {
    assertRun(image, row.x, trackY, row.width, COLORS.text, `${label}: empty track`);
    return;
  }

  const filledWidth = percent >= 100 ? row.width : snapToGrid(Math.max(row.height, Math.round(row.width * percent / 100)));
  for (let y = trackY; y < trackY + 2; y += 1) {
    assertRun(image, row.x, y, filledWidth, row.color, `${label}: filled center row`);
  }

  if (filledWidth < row.width) {
    assertRun(image, row.x + filledWidth, trackY, row.width - filledWidth, COLORS.text, `${label}: remaining track`);
  }
}

function assertRun(image, x, y, width, expectedColor, label) {
  for (let offset = 0; offset < width; offset += 1) {
    const px = x + offset;
    if (!sameColor(image.pixel(px, y), expectedColor)) {
      failures.push(`${label} pixel ${px},${y} was ${formatColor(image.pixel(px, y))}, expected ${formatColor(expectedColor)}`);
      return;
    }
  }
}

function decodePng(dataUri) {
  const encoded = dataUri.split(",", 2)[1];
  if (!encoded) throw new Error("Expected a PNG data URI.");

  const buffer = Buffer.from(encoded, "base64");
  const idat = [];
  let width = 0;
  let height = 0;
  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("Expected an 8-bit RGBA PNG.");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const rowStride = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    if (raw[y * rowStride] !== 0) throw new Error("Expected unfiltered PNG rows.");
  }

  return {
    pixel(x, y) {
      const pixelOffset = y * rowStride + 1 + x * 4;
      return [raw[pixelOffset], raw[pixelOffset + 1], raw[pixelOffset + 2], raw[pixelOffset + 3]];
    }
  };
}

function snapToGrid(value) {
  return Math.round(value / 2) * 2;
}

function sameColor(actual, expected) {
  return expected.every((channel, index) => actual[index] === channel);
}

function formatColor(color) {
  return `rgba(${color.join(",")})`;
}
