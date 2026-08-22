// Monaco worker bootstrap — a real file instead of a blob: URL so that
// MV3 extension CSP (script-src 'self') allows the worker.
// baseUrl must point at the folder that CONTAINS vs/ — module ids already
// carry the "vs/" prefix (vs/language/json/jsonWorker and friends).
self.MonacoEnvironment = {
  baseUrl: new URL('monaco/', self.location.href).href,
};
importScripts(new URL('monaco/vs/base/worker/workerMain.js', self.location.href).href);
