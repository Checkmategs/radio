import { spawn } from "node:child_process";
import fs from "node:fs";

export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const content = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!stamps.length || !content) continue;
    for (const stamp of stamps) {
      lines.push({
        t: Number(stamp[1]) * 60 + Number(stamp[2]),
        text: content,
      });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return withWords(lines);
}

export function linesFromPlain(text, duration) {
  const sections = [];
  let current = { rows: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    if (/^\[текст/i.test(row)) continue;
    if (isMetaLine(row)) {
      if (current.rows.length) sections.push(current);
      current = { rows: [] };
      continue;
    }
    current.rows.push(row);
  }
  if (current.rows.length) sections.push(current);
  const rows = sections.flatMap((section) => section.rows);
  if (!rows.length || duration <= 0) return [];

  const head = Math.min(6, duration * 0.05);
  const tail = Math.min(4, duration * 0.03);
  const usable = Math.max(1, duration - head - tail);
  const sectionWeights = sections.map((section) =>
    section.rows.reduce((sum, row) => sum + lineWeight(row), 0),
  );
  const totalWeight = sectionWeights.reduce((sum, value) => sum + value, 0) || 1;

  let t = head;
  const lines = [];
  sections.forEach((section, index) => {
    const budget = usable * (sectionWeights[index] / totalWeight);
    const weights = section.rows.map(lineWeight);
    const local = weights.reduce((sum, value) => sum + value, 0) || 1;
    section.rows.forEach((row, rowIndex) => {
      lines.push({ t, text: row });
      t += budget * (weights[rowIndex] / local);
    });
  });
  return withWords(lines);
}

function lineWeight(row) {
  return Math.max(10, row.replace(/\s+/g, " ").length);
}

export function withWords(lines) {
  return lines.map((line, index) => {
    const next = lines[index + 1]?.t ?? line.t + 3.5;
    const words = line.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.35, next - line.t);
    return {
      t: line.t,
      text: line.text,
      words: words.map((word, wordIndex) => ({
        t: line.t + (span * wordIndex) / Math.max(words.length, 1),
        text: word,
      })),
    };
  });
}

export function isMetaLine(row) {
  return (
    /^\[текст/i.test(row) ||
    /^\[[^\]]+\]$/.test(row) ||
    /^lyrics$/i.test(row)
  );
}

export function sidecarMtime(filePath) {
  const base = filePath.replace(/\.[^.]+$/, "");
  let latest = 0;
  for (const ext of [".lrc", ".txt"]) {
    try {
      latest = Math.max(latest, fs.statSync(base + ext).mtimeMs);
    } catch {
      // no sidecar
    }
  }
  return latest;
}

export function readSidecarLyrics(filePath, duration) {
  const base = filePath.replace(/\.[^.]+$/, "");
  try {
    return parseLrc(fs.readFileSync(`${base}.lrc`, "utf8"));
  } catch {
    // fall through
  }
  try {
    return linesFromPlain(fs.readFileSync(`${base}.txt`, "utf8"), duration);
  } catch {
    return [];
  }
}

export function extractTagLyrics(filePath) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags",
      "-of",
      "json",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
    });
    proc.on("error", () => resolve(""));
    proc.on("close", () => {
      try {
        const tags = JSON.parse(out).format?.tags || {};
        const key = Object.keys(tags).find((name) => /lyric/i.test(name));
        resolve(key ? String(tags[key]) : "");
      } catch {
        resolve("");
      }
    });
  });
}

export async function loadLyrics(filePath, duration) {
  const sidecar = readSidecarLyrics(filePath, duration);
  if (sidecar.length) return sidecar;
  const tagged = await extractTagLyrics(filePath);
  return tagged ? linesFromPlain(tagged, duration) : [];
}
