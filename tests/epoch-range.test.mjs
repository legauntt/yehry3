import {test} from 'node:test';
import assert from 'node:assert/strict';
import {epochDescription} from '../assets/epoch-range.js';
import {voiceModelBadge} from '../assets/song-badges.js';
import {requestPromptBrief, publicPromptBrief, promptSummary} from '../assets/prompt-brief.js';
test('range checkpoints stay visible in briefs and badges', () => {
  const item = {voiceModel: 'v9', voiceEpochRange: {start: 10, end: 300}};
  assert.equal(epochDescription(item), ' · epochs 10 → 300');
  assert.match(voiceModelBadge(item), /epochs 10 → 300/);
  assert.match(voiceModelBadge({details: item}), /epochs 10 → 300/);
  assert.match(requestPromptBrief({prompt:'A journey', details:item}, String), /epochs 10 → 300/);
  assert.match(publicPromptBrief({originalPrompt:{...item,idea:'A journey'}}, String), /epochs 10 → 300/);
  assert.match(promptSummary(item, String), /epochs 10 → 300/);
  assert.equal(epochDescription({voiceModel: 'v8', voiceEpochRange: item.voiceEpochRange}), '');
  assert.equal(epochDescription({voiceModel: 'v9', voiceEpoch: 50}), ' · epoch 50');
});
