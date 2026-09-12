self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.songId;
  const url = new URL("/queue/", self.location.origin);
  if (/^distonyc-[a-f0-9]{24}$/.test(id || "")) url.hash = id;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const queue = windows.find(
        (client) => new URL(client.url).pathname === "/queue/",
      );
      if (queue) {
        await queue.navigate(url.href);
        await queue.focus();
      } else await self.clients.openWindow(url.href);
    })(),
  );
});
