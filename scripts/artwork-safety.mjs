import { treatments } from './artwork-policy.mjs';

export const MAX_SAFETY_RETRIES = 2;
// Match provider error codes, never song words or a generic failed request.
export function isSafetyRejection(log) {
  return /["']code["']\s*:\s*["'](?:moderation_blocked|content_policy_violation)["']/.test(log);
}
export function safetyRetryCount(ledger, songId) {
  return (ledger.events || []).filter(e => e.type === 'safety-retry' && e.songId === songId).length;
}
export function makeSafetyPrompt(packet, treatment, attempt) {
  if (!treatments[treatment] || ![1, 2].includes(attempt)) throw new Error('Invalid safety interpretation');
  // Only fixed benign vocabulary crosses this boundary. Raw lyrics, titles,
  // requests, names and arbitrary planner strings remain in the local audit.
  const song = packet?.song || {};
  const plan = song.songPlan || {};
  const settings = plan.musicalSettings || {};
  const music = [song.genre, song.style, plan.style, settings.genre,
    settings.instruments, plan.arrangement].flat().filter(v => typeof v === 'string').join(' ').toLowerCase();
  const visual = [song.title, song.lyrics?.text || song.lyrics, song.originalPrompt?.idea,
    plan.lyrics].filter(v => typeof v === 'string').join(' ').toLowerCase();
  const genres = ['rock', 'opera', 'jazz', 'folk', 'acoustic', 'synth', 'disco', 'blues', 'punk', 'orchestral'];
  const instruments = ['guitar', 'piano', 'organ', 'drums', 'bass', 'saxophone', 'trumpet', 'violin', 'cello', 'keyboard', 'banjo', 'harmonica'];
  const motifs = ['glass', 'window', 'mirror', 'doorway', 'street', 'city', 'rain', 'moon', 'stars',
    'sunrise', 'sunset', 'ocean', 'river', 'garden', 'forest', 'train', 'stage', 'road', 'night',
    'neon', 'candle', 'shadow', 'storm'];
  const matches = (source, words) => words.filter(word => new RegExp(`\\b${word}\\b`).test(source));
  const genre = matches(music, genres).join(', ') || 'expressive music';
  const palette = matches(music, instruments).slice(0, 5).join(', ') || 'the band’s rhythm and texture';
  const subjects = matches(visual, motifs).slice(0, 3).join(', ') || 'light, weather and an open landscape';
  return `Create original square album artwork, readable at thumbnail size.
This is a new, safe visual interpretation. You may freely change the subject, setting, composition and details to produce suitable artwork. Safety takes precedence over literal fidelity.
Musical character: ${genre}. Finish level: ${treatment}; ${treatments[treatment].quality} quality.
Musical palette: ${palette}. Let the instruments and genre guide the color, rhythm and physical texture.
${attempt === 1 ? `Choose an atmospheric, non-graphic scene or visual metaphor using these safe cues from the song if useful: ${subjects}. An instrument or fully clothed adult musician can anchor the picture; if Tony C is depicted, give him a flat/newsboy cap or baseball cap.` : `Create a purely abstract composition of light, color, rhythm and tactile painted textures, using the musical palette and safe visual cues (${subjects}) only as abstract shapes. No people, human bodies, characters or narrative events.`}
Do not depict sexual acts, nudity, sexualized poses, coercion, abuse, hate symbols, propaganda, bodily waste, injury or gore. Do not reproduce rejected imagery. No text, titles, lyrics, letters, logos, badges, watermarks or clip art. Keep the focal composition within the central 80 percent.
`;
}
