// Link previews read the page's OpenGraph metadata; people are sent on to the song in the collection.
const id = location.pathname.split("/").filter(Boolean)[1];
if (/^[a-z0-9-]{1,120}$/.test(id || "")) {
  // The collection reads this to badge the song as shared; without storage it simply lands on the song.
  try { sessionStorage.setItem("yehry3:shared-song", JSON.stringify({ id, at: Date.now() })); } catch { /* Storage may be blocked. */ }
  location.replace(`/#${encodeURIComponent(id)}`);
}
