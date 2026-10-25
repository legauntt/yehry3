import {test} from 'node:test';
import assert from 'node:assert/strict';
import {epochDescription} from '../assets/epoch-range.js';
import {voiceModelBadge} from '../assets/song-badges.js';
import {requestPromptBrief, publicPromptBrief, promptSummary} from '../assets/prompt-brief.js';
test('range checkpoints stay visible in briefs and badges', () => {
  const item = {voiceModel: 'v9', voiceEpochRange: {start: 10, end: 300}};
  assert.equal(epochDescription(item), ' · epochs 10 → 300');
  assert.match(voiceModelBadge(item), /epochs 10 → 300/);
  assert.match(voiceModelBadge(item), /class="voice-epoch-number" aria-hidden="true">10→300<\/span>/);
  assert.match(voiceModelBadge(item), /v9-epoch-150/);
  assert.match(voiceModelBadge({details: item}), /epochs 10 → 300/);
  assert.match(requestPromptBrief({prompt:'A journey', details:item}, String), /epochs 10 → 300/);
  assert.match(publicPromptBrief({originalPrompt:{...item,idea:'A journey'}}, String), /epochs 10 → 300/);
  assert.match(promptSummary(item, String), /epochs 10 → 300/);
  assert.equal(epochDescription({voiceModel: 'v8', voiceEpochRange: item.voiceEpochRange}), '');
  assert.equal(epochDescription({voiceModel: 'v9', voiceEpoch: 50}), ' · epoch 50');
});

test('V9 badges show the chosen checkpoint on each entry', () => {
  for (const epoch of [50, 200, 300]) {
    const badge = voiceModelBadge({voiceModel: 'v9', voiceEpoch: epoch});
    assert.match(badge, new RegExp(`v9-epoch-${epoch}`));
    assert.match(badge, new RegExp(`class="voice-epoch-number" aria-hidden="true">${epoch}<\\/span>`));
    assert.match(badge, new RegExp(`aria-label="Tony’s voice: V9 · epoch ${epoch}"`));
  }
  assert.match(voiceModelBadge({voiceModel: 'v9'}), /v9-epoch-300/);
  assert.match(voiceModelBadge({voiceModel: 'v9'}), /class="voice-epoch-number" aria-hidden="true">300<\/span>/);
  assert.doesNotMatch(voiceModelBadge({voiceModel: 'v8', voiceEpoch: 50}), /voice-epoch-number/);
});
