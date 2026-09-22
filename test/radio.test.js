import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, parseFfmpegDuration } from "../src/radio.js";

test("strips extension from track name", () => {
  assert.equal(cleanName("ночь.mp3"), "ночь");
});

test("parses ffmpeg duration line", () => {
  assert.equal(parseFfmpegDuration("Duration: 00:03:21.05, start: 0.000000"), 201.05);
  assert.equal(parseFfmpegDuration("no duration here"), 0);
});
