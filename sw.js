self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json?.() || {}; } catch { payload = { title: event.data?.text?.() || "LΛN Portfolio" }; }
  const title = String(payload.title || "LΛN Portfolio");
  const icon = String(payload.icon || "/assets/images/hero.png");
  const options = {
    body: String(payload.body || ""),
    icon,
    badge: icon,
    tag: String(payload.tag || "lan-portfolio-notification"),
    renotify: true,
    data: { url: String(payload.url || "/") }
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const delivery = payload.delivery;
    if (!delivery?.id || !delivery?.token || !delivery?.ackUrl) return;
    const response = await fetch(String(delivery.ackUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: String(delivery.id), token: String(delivery.token) })
    });
    if (!response.ok) throw new Error(`Push delivery acknowledgment failed (${response.status}).`);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification?.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await clients.openWindow(target);
  })());
});
