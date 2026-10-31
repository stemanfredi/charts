// Runs clip.js's clipper off the main thread (see startClipWorker in clip.js).
import { clipper } from './clip.js';
import { fetchAllInto } from './net.js';

const clippers = {}, running = new Map(); // seq → its AbortController (a cancel from the page aborts it)
self.onmessage = async ({ data }) => {
  if (data.init) {
    // keep: { cache, reload }, a worker saving an area (offline.js): every file it reads goes into
    // the area's cache, each said to the page ({ stored: bytes, url })
    const { keep } = data.init;
    if (keep) fetchAllInto({ cache: caches.open(keep.cache), reload: keep.reload, stored: (stored, url) => self.postMessage({ stored, url }) });
    clippers[data.init.mode] = clipper(data.init);
    return;
  }
  if (data.cancel) { running.get(data.cancel)?.abort(); return; }
  try {
    if (!clippers[data.mode]) throw new Error(`the ${data.mode} clipper was not set up`);
    const ac = new AbortController();
    running.set(data.seq, ac);
    const value = await clippers[data.mode][data.op](...data.zxy, ac.signal).finally(() => running.delete(data.seq));
    self.postMessage({ seq: data.seq, value }, [value instanceof Float32Array ? value.buffer : value]);
  } catch (err) {
    self.postMessage({ seq: data.seq, error: String(err?.message || err), name: err?.name }); // its name: a storage full is said as one
  }
};
