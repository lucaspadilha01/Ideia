// Cache apenas do shell estático; /api e /mcp nunca são cacheados.
const SHELL = ["/", "/app.js", "/style.css", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (e) => e.waitUntil(caches.open("shell-v1").then((c) => c.addAll(SHELL))));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.pathname === "/mcp") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
