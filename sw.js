const CACHE_NAME = "zen-match3-v1.2.13";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  // Pre-caching не блокирует установку SW — если сеть недоступна,
  // файлы всё равно закэшируются при первом сетевом запросе.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES_TO_CACHE))
      .catch(() => { /* тихо: install не падает */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Пропускаем не-GET: POST и прочие SW не кэширует
  if (event.request.method !== "GET") return;

  // Network-first: всегда берём свежее с сервера.
  // Кэш используется только при отсутствии сети (офлайн).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кэшируем только валидные same-origin ответы (не opaque)
        if (response.status === 200 && response.type !== "opaque") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        // Гарантируем валидный Response — undefined вызовет ошибку SW
        caches.match(event.request).then((r) => r || new Response("Offline", { status: 503 }))
      )
  );
});