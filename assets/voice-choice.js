// Which Tony voice a request form starts on. A pick made in the voice menu is remembered per browser,
// like Tony's pitch; someone who never touches the menu keeps following the site's default.
const rememberKey = 'yehry3:voice-model-v1';
const versioned = (value) => /^v[1-9]\d*$/.test(value || '') ? value : null;
// V8 and V9 requests are made through V8 song generation, so they are only a default while it is available.
export const usesGeneration = (id) => id === 'v8' || id === 'v9';
export const rememberedVoice = () => { try { return versioned(localStorage.getItem(rememberKey)); } catch { return null; } };
export const rememberVoice = (value) => { try { localStorage.setItem(rememberKey, value); } catch { /* The request still carries the choice. */ } };

// The request's own saved voice comes first, then this browser's last pick, then the newest voice on offer.
export function startingVoice({ saved, remembered, models, generationAvailable }) {
  if (versioned(saved)) return saved;
  const offered = (id) => models.some((model) => model.id === id) && (generationAvailable || !usesGeneration(id));
  if (remembered && offered(remembered)) return remembered;
  return ['v9', 'v8', 'v7'].find(offered) || models[0].id;
}
