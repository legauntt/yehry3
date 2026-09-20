// Link previews read the page's OpenGraph metadata; people are sent on to the song in the collection.
const id = location.pathname.split("/").filter(Boolean)[1];
if (/^[a-z0-9-]{1,120}$/.test(id || "")) location.replace(`/#${encodeURIComponent(id)}`);
