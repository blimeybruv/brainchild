// Rules for hosted browser builds, shared by the upload API (api/builds.js) and the Worker
// that serves them on brainwave.nexus (builds-worker/worker.js).

export const BUILD_HOST = "brainwave.nexus";          // each game gets <project id>.brainwave.nexus
export const MAX_FILE_BYTES = 25 * 1024 * 1024;       // one file
export const MAX_BUILD_BYTES = 100 * 1024 * 1024;     // one build
export const MAX_BUILD_FILES = 400;
export const MAX_ALL_BUILDS_BYTES = 9 * 1024 * 1024 * 1024; // everything stored, under R2's free 10 GB

// Only these kinds of file can be uploaded, and each is always served as the type listed here.
export const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", map: "application/json",
  webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", xml: "application/xml",
  csv: "text/csv; charset=utf-8", wasm: "application/wasm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  glb: "model/gltf-binary", gltf: "model/gltf+json",
  bin: "application/octet-stream", data: "application/octet-stream", pck: "application/octet-stream",
  unityweb: "application/octet-stream", mem: "application/octet-stream", dat: "application/octet-stream",
  atlas: "text/plain; charset=utf-8", fnt: "text/plain; charset=utf-8", ktx2: "image/ktx2"
};

// Returns the cleaned relative path ("assets/main.js"), or null if it isn't allowed.
// No "..", no hidden files (so a stray .env is never published), no odd characters.
export function cleanPath(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 300) return null;
  const parts = raw.split("/");
  if (parts.length > 12) return null;
  for (const part of parts) {
    if (!/^[A-Za-z0-9_@()+,\- ][A-Za-z0-9._@()+,\- ]{0,119}$/.test(part) || part.endsWith(".") || part.endsWith(" ")) return null;
  }
  return parts.join("/");
}

export function typeFor(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return TYPES[path.slice(dot + 1).toLowerCase()] || null;
}

// A project id can be a sub-address only if it fits in one DNS label.
export function hostFor(projectId) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(projectId) ? projectId + "." + BUILD_HOST : null;
}
