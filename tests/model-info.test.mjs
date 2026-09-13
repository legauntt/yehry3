import { test } from "node:test";
import assert from "node:assert/strict";
import { modelInfoButton, modelComparison } from "../assets/model-info.js";

test("only the three known V7 studies expose model information, without interpolating song input", () => {
  for (const id of ["telephone-wire-tony-v7-study", "spare-key-weather-tony-v7-study", "the-last-light-in-the-station-tony-v7-study"]) {
    const html = modelInfoButton({ id, title: '<img src=x onerror="alert(1)">' });
    assert.match(html, /aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /<img|onerror/);
  }
  for (const item of [undefined, {}, { id: "legacy-song", title: "Tony V7 Study" }, { id: '<script>' }]) {
    assert.equal(modelInfoButton(item), "");
  }
  assert.ok(modelComparison.every(([label, text]) => typeof label === "string" && typeof text === "string"));
});
