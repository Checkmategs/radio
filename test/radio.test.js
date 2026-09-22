import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeOriginalName } from "../src/radio.js";

test("keeps already-valid unicode filenames", () => {
  assert.equal(decodeOriginalName("ночь.mp3"), "ночь.mp3");
});

test("repairs latin1-misdecoded unicode filenames", () => {
  const broken = Buffer.from("ночь.mp3", "utf8").toString("latin1");
  assert.equal(decodeOriginalName(broken), "ночь.mp3");
});

test("falls back when name is empty", () => {
  assert.equal(decodeOriginalName(""), "без названия");
});

test("parses ffmpeg duration line", async () => {
  const { parseFfmpegDuration } = await import("../src/radio.js");
  assert.equal(parseFfmpegDuration("Duration: 00:03:21.05, start: 0.000000"), 201.05);
  assert.equal(parseFfmpegDuration("no duration here"), 0);
});
