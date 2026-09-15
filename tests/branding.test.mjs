import { test } from "node:test";
import assert from "node:assert/strict";
import { brandLines, pickBrandLine } from "../assets/brand-lines.js";

test("branding offers exactly 100 distinct compact headlines and avoids the previous visit's line", () => {
  assert.equal(brandLines.length, 100);
  assert.equal(new Set(brandLines).size, 100);
  for (const line of brandLines) {
    assert.equal(line.split("\n").length, 2);
    assert.ok(line.split("\n").every(part => part.length > 0 && part.length <= 36));
    assert.notEqual(pickBrandLine(line, () => 0), line);
    assert.notEqual(pickBrandLine(line, () => .99999), line);
  }
});
