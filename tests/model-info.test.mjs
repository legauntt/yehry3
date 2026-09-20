import { test } from "node:test";
import assert from "node:assert/strict";
import { modelInfoButton, modelComparison } from "../assets/model-info.js";

test("the request-form voice comparison trigger is static", () => {
  const html = modelInfoButton();
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /Compare voices/);
  assert.ok(modelComparison.some(([label, text]) => label.startsWith("V8") && text.includes("35 recordings")));
  assert.ok(modelComparison.some(([, text]) => text.includes("0.037%") && text.includes("0.027%")));
  assert.ok(modelComparison.some(([label, text]) => label.startsWith("V9") && text.includes("RVC")));
  assert.ok(modelComparison.some(([label, text]) => label.startsWith("Which") && text.includes("V9 is the default")));
  assert.ok(modelComparison.every(([label, text]) => typeof label === "string" && typeof text === "string"));
});
