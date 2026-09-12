(() => {
  'use strict';
  const cards = [...document.querySelectorAll('.track')];
  const players = cards.map(card => card.querySelector('audio'));
  const status = document.querySelector('#status');
  const shuffleButton = document.querySelector('#shuffle');
  let shuffled = false;
  let queue = [];
  let cursor = -1;

  function order(items) {
    const copy = [...items];
    if (shuffled) {
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
    }
    return copy;
  }
  function title(index) { return cards[index].querySelector('h3').textContent; }
  function markPlaying(index) {
    players.forEach((player, i) => {
      if (i !== index) player.pause();
      cards[i].classList.toggle('is-playing', i === index);
    });
    status.textContent = `Playing ${title(index)}.`;
  }
  async function playQueued() {
    const index = queue[cursor];
    if (index === undefined) return;
    players[index].currentTime = 0;
    try { await players[index].play(); }
    catch { status.textContent = `Press play on ${title(index)} to continue, or use its download link.`; }
  }

  players.forEach((player, index) => {
    player.addEventListener('play', () => {
      if (queue[cursor] !== index) { queue = [index]; cursor = 0; }
      markPlaying(index);
    });
    player.addEventListener('pause', () => {
      cards[index].classList.remove('is-playing');
      if (queue[cursor] === index && !player.ended) status.textContent = `Paused · ${title(index)}.`;
    });
    player.addEventListener('ended', () => {
      cards[index].classList.remove('is-playing');
      if (queue[cursor] === index && cursor + 1 < queue.length) {
        cursor++;
        void playQueued();
      } else status.textContent = 'Finished. Choose a version or play all again.';
    });
    player.addEventListener('error', () => {
      if (queue[cursor] === index) status.textContent = `Unable to play ${title(index)}. Try its MP3 download link.`;
    });
  });
  document.querySelector('#play-all').addEventListener('click', () => {
    players.forEach(player => player.pause());
    queue = order(players.map((_, i) => i));
    cursor = 0;
    void playQueued();
  });
  shuffleButton.addEventListener('click', () => {
    shuffled = !shuffled;
    shuffleButton.setAttribute('aria-pressed', String(shuffled));
    if (queue.length > 1 && cursor >= 0) {
      const past = queue.slice(0, cursor + 1);
      const remaining = queue.slice(cursor + 1).sort((a, b) => a - b);
      queue = [...past, ...order(remaining)];
    }
  });
  document.querySelector('.collection-controls').hidden = false;
})();
