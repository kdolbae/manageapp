/* 집대리 서비스 워커 — 번들러 없이 그대로 배포되는 파일.
 * 배포할 때 VERSION 을 올리면 activate 때 이전 캐시가 지워진다.
 *
 * 전략
 *  - 페이지 이동(mode "navigate"): 네트워크 우선, 실패하면 캐시된 /offline
 *  - /_next/static/, /icons/: 캐시 우선 (해시가 붙은 불변 파일)
 *  - 손대지 않는 것: /api/, /auth/, /_next/image, GET 이 아닌 요청(서버 액션 포함),
 *    다른 출처(Supabase 등)로 가는 요청
 */
const VERSION = "2026-09-23.1";
const CACHE = "jip-" + VERSION;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/_next/image")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  }
});

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
  // 오프라인 페이지가 쓰는 스크립트·CSS 도 같이 담아 둔다. 없으면 오프라인에서 스타일·버튼이 안 나온다.
  const page = await cache.match(OFFLINE_URL);
  if (!page) return;
  const html = await page.text();
  const assets = Array.from(new Set(html.match(/\/_next\/static\/[^"'\s\\<>)]+/g) || []));
  await Promise.all(assets.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)));
}

async function networkFirstPage(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ||
      new Response("지금은 오프라인입니다.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}
