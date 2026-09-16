// Pure validator shared with the API; schema mirrors the trusted worker contract.
export function normalizeGeneration(value, schema) {
  if (value == null) return null;
  const fail = (message) => { throw new Error(message); };
  if (typeof value !== 'object' || Array.isArray(value) || value.version !== 1) fail('Unsupported generation options.');
  const { ranges, choices, textLimits, listLimits, defaults } = schema;
  const result = { ...defaults };
  const plain = (item, max, key) => {
    if (typeof item !== 'string' || item.length > max || /[\x00-\x1f\x7f]/.test(item)) fail(`Invalid ${key}: use plain text, up to ${max} characters.`);
    return item.trim();
  };
  for (const [key, item] of Object.entries(value)) {
    if (key === 'version') continue;
    if (key === 'reviewLyrics') {
      if (typeof item !== 'boolean') fail('Choose whether to review lyrics.');
      result[key] = item;
    } else if (Object.hasOwn(ranges, key)) {
      if (item === null && !Object.hasOwn(defaults, key)) continue;
      const [min, max] = ranges[key];
      if (typeof item !== 'number' || !Number.isFinite(item) || item < min || item > max || (!key.endsWith('GainDb') && !Number.isInteger(item))) fail(`${key} must be between ${min} and ${max}.`);
      result[key] = item;
    } else if (Object.hasOwn(choices, key)) {
      if (item === null && !Object.hasOwn(defaults, key)) continue;
      if (!choices[key].includes(item)) fail(`Unsupported ${key}.`);
      result[key] = item;
    } else if (Object.hasOwn(textLimits, key)) {
      if (item === null) continue;
      const clean = plain(item, textLimits[key], key);
      if (clean) {
        if (key === 'keyscale' && !new RegExp(schema.keyPattern).test(clean)) fail('Choose a major or minor key.');
        result[key] = clean;
      }
    } else if (Object.hasOwn(listLimits, key)) {
      const [count, max] = listLimits[key];
      if (!Array.isArray(item) || item.length > count) fail(`${key} allows up to ${count} entries.`);
      const entries = item.map((v) => plain(v, max, key));
      if (entries.some((v) => !v) || new Set(entries.map((v) => v.toLowerCase())).size !== entries.length) fail(`Remove empty or duplicate ${key} entries.`);
      if (entries.length) result[key] = entries;
    } else fail(`Unknown generation option: ${key}`);
  }
  if ((result.instruments || []).some((v) => (result.avoidInstruments || []).some((other) => other.toLowerCase() === v.toLowerCase()))) fail('An instrument cannot be both requested and excluded.');
  return result;
}
