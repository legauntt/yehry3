// Keep fixture feedback on the same separate, uncached path as the real API.
export function mockCatalogState(page, songs, nextVoteAt = () => null) {
  return page.route("**/yehry3/catalog/state", route => route.fulfill({ json: {
    feedback: Object.fromEntries(songs().filter(song => song.feedback).map(song => [song.id, song.feedback])),
    nextVoteAt: nextVoteAt(),
  } }));
}
