// A newly published pretty link may arrive before its static share page is built.
// Use the shared shell so the pretty URL, moment and player remain intact.
if (/^\/lyrics\/[a-z0-9-]{1,72}-[a-f0-9]{6}(?:\/(?:index\.html)?)?$/.test(location.pathname)) {
  const { definePage, navigate } = await import("./shell.js");
  definePage(import.meta.url, () => navigate(location.href, { push: false }));
}
