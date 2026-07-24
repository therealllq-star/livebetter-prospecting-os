self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" ? payload.title : "New inbound lead";
  const body = typeof payload.body === "string" ? payload.body : "A new lead was received.";
  const data = payload && typeof payload === "object" ? payload.data || {} : {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data && data.leadId ? `lead:${data.leadId}` : undefined,
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification && event.notification.data ? event.notification.data : {};
  const targetUrl = typeof data.url === "string" && data.url ? data.url : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
