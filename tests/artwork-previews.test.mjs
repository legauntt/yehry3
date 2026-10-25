import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { buildArtworkPreviews } from "../scripts/artwork-previews.mjs";
import artwork from "../assets/artwork-catalog.js";
import previews from "../dist/assets/artwork-previews.js";

test("every saved cover ships correctly sized responsive candidates and an untouched original", async () => {
  for (const art of Object.values(artwork)) {
    const preview = previews[art.src];
    assert.ok(preview, `Missing previews for ${art.src}`);
    assert.deepEqual(await readFile(`dist${art.src}`), await readFile(`.${art.src}`));
    for (const candidate of preview.srcset.split(", ")) {
      const [src, descriptor] = candidate.split(" ");
      const metadata = await sharp(`dist${src}`).metadata();
      assert.equal(`${metadata.width}w`, descriptor);
      assert.ok(metadata.width <= preview.width, "Never upscale a small original");
      assert.ok(Math.abs(metadata.height / metadata.width - preview.height / preview.width) < .01, "Preserve composition/aspect ratio");
    }
  }
});

test("a new cover automatically gets previews; changing its bytes invalidates preview URLs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cover-previews-"));
  try {
    await mkdir(path.join(root, "assets/artwork"), { recursive: true });
    const src = "/assets/artwork/new-cover.webp", source = path.join(root, src);
    const write = background => sharp({ create: { width: 384, height: 320, channels: 3, background } }).webp().toFile(source);
    await write("red");
    const before = await readFile(source);
    const first = await buildArtworkPreviews(root, path.join(root, "dist"), { new: { src } });
    assert.deepEqual(await readFile(source), before);
    assert.equal(first[src].srcset.split(", ").length, 3); // 160, 320, original 384
    await write("blue");
    const second = await buildArtworkPreviews(root, path.join(root, "dist"), { new: { src } });
    assert.notEqual(first[src].srcset, second[src].srcset);
  } finally { await rm(root, { recursive: true }); }
});
