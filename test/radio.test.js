import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, parseFfmpegDuration } from "../src/radio.js";
import { isMetaLine, linesFromPlain, parseLrc } from "../src/lyrics.js";

test("strips extension from track name", () => {
  assert.equal(cleanName("ночь.mp3"), "ночь");
});

test("parses ffmpeg duration line", () => {
  assert.equal(parseFfmpegDuration("Duration: 00:03:21.05, start: 0.000000"), 201.05);
  assert.equal(parseFfmpegDuration("no duration here"), 0);
});

test("parses lrc timestamps", () => {
  const lines = parseLrc("[00:12.00]привет мир\n[00:15.50]вторая");
  assert.equal(lines[0].t, 12);
  assert.equal(lines[0].text, "привет мир");
  assert.equal(lines[0].words[0].text, "привет");
  assert.equal(lines[1].t, 15.5);
});

test("times plain lyrics across a track", () => {
  const lines = linesFromPlain("[Текст песни]\n\n[Припев]\nраз\nдва", 100);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].t > 0);
  assert.ok(lines[1].t > lines[0].t);
});

test("skips lyric meta headings", () => {
  assert.equal(isMetaLine("[Припев: Voskresenskii]"), true);
  assert.equal(isMetaLine("Я заболел флексом"), false);
});
