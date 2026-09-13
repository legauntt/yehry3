import { test } from "node:test";
import assert from "node:assert/strict";
import { modelInfoButton, modelComparison } from "../assets/model-info.js";

test("the request-form voice comparison trigger is static", () => {
  const html = modelInfoButton();
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /V6 vs V7/);
  assert.ok(modelComparison.every(([label, text]) => typeof label === "string" && typeof text === "string"));
});
