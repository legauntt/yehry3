import test from "node:test";
import assert from "node:assert/strict";
import { gpuWaiting, gpuWaitNotice } from "../assets/gpu-status.js";

test("GPU wait uses active worker progress and never permission-error text", () => {
  for (const stage of ["Waiting for the GPU", "Waiting for the current renderer", "Movement 2 of 3 · Waiting for the GPU"]) {
    assert.equal(gpuWaiting({ status: "processing", progress: { stage } }), true);
    assert.match(gpuWaitNotice({ status: "processing", workerProgress: { stage } }), /continue automatically/);
  }
  for (const status of ["queued", "failed", "cancel_requested", "canceled", "completed", "published"]) {
    assert.equal(gpuWaitNotice({ status, progress: { stage: "Waiting for the GPU" }, workerError: "Permission denied" }), "");
  }
  for (const stage of ["Permission denied", "Rendering", "Waiting for the GPU failed", "<script>Waiting for the GPU</script>"]) {
    assert.equal(gpuWaitNotice({ status: "processing", workerProgress: { stage }, workerError: "Permission denied" }), "");
  }
  assert.equal(gpuWaiting(null), false);
});
