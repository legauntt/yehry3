self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// A finished song belongs on the listening room, where it can be played, rather
// than the production queue it has just left.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.songId;
  const url = new URL("/", self.location.origin);
  if (/^distonyc-[a-f0-9]{24}$/.test(id || "")) url.hash = id;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const listeningRoom = windows.find(
        (client) => new URL(client.url).pathname === "/",
      );
      if (listeningRoom) {
        const focused = (await listeningRoom.navigate(url.href)) || listeningRoom;
        await focused.focus();
      } else await self.clients.openWindow(url.href);
    })(),
  );
});
