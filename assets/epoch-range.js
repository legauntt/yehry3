export function mountEpochRange(root, { epochs, initial, storage, draftId, tabs, voice, single }) {
  const key = `voice-epoch-range-draft:${draftId}`;
  let saved;
  try { saved = JSON.parse(storage.get(key) || 'null'); } catch {}
  const value = saved || initial;
  root.innerHTML = `<details><summary>V9 epoch range</summary><label><input type="checkbox" id="epoch-range-enabled"> Progress through a range of checkpoints</label><p class="small">Tony changes voice between sung passages, using every saved checkpoint from start to end in steps of 10. Supports songs up to 10 minutes. Choose a shorter range for a song with little singing.</p><div id="epoch-range-controls"><label for="epoch-range-start">Starting epoch</label><select id="epoch-range-start"></select><label for="epoch-range-end">Ending epoch</label><select id="epoch-range-end"></select><p class="small" id="epoch-range-description" aria-live="polite"></p></div></details>`;
  const enabled = root.querySelector('#epoch-range-enabled');
  const start = root.querySelector('#epoch-range-start'), end = root.querySelector('#epoch-range-end');
  for (const select of [start, end]) select.innerHTML = epochs.map(epoch => `<option value="${epoch}">${epoch}</option>`).join('');
  enabled.checked = Boolean(value?.enabled ?? value);
  start.value = String(epochs.includes(value?.start) ? value.start : epochs[0]);
  end.value = String(epochs.includes(value?.end) ? value.end : epochs.at(-1));
  function sync() {
    const active = voice.value === 'v9' && epochs.length > 1;
    root.hidden = !active;
    enabled.disabled = !active;
    start.disabled = end.disabled = !active || !enabled.checked;
    root.querySelector('#epoch-range-controls').hidden = !enabled.checked;
    if (epochs.length) single.disabled = !active || enabled.checked;
    end.setCustomValidity(enabled.checked && Number(start.value) >= Number(end.value) ? 'Choose an ending epoch after the starting epoch.' : '');
    const count = epochs.filter(epoch => epoch >= Number(start.value) && epoch <= Number(end.value)).length;
    root.querySelector('#epoch-range-description').textContent = `${count} checkpoints, in ascending order: ${start.value} → ${end.value}.`;
  }
  function remember() {
    storage.set(key, JSON.stringify({ enabled: enabled.checked, start: Number(start.value), end: Number(end.value) }));
    sync();
  }
  for (const input of [enabled, start, end]) input.onchange = remember;
  root.addEventListener('invalid', () => { root.querySelector('details').open = true; }, true);
  sync();
  return {
    sync,
    open() { tabs.openSection('V9 epoch range'); },
    read() {
      if (voice.value !== 'v9' || !enabled.checked) return null;
      if (!end.checkValidity()) throw new Error(end.validationMessage);
      return { start: Number(start.value), end: Number(end.value) };
    },
    clear() { storage.remove(key); },
  };
}

export function epochDescription(item) {
  if (item?.voiceModel !== 'v9') return '';
  return item.voiceEpochRange ? ` · epochs ${item.voiceEpochRange.start} → ${item.voiceEpochRange.end}`
    : item.voiceEpoch ? ` · epoch ${item.voiceEpoch}` : '';
}
