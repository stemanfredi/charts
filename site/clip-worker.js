// Runs clip.js's clipper off the main thread (see startClipWorker in clip.js).
import { clipper } from './clip.js';

const clippers = {}, running = new Map(); // seq → its AbortController (a cancel from the page aborts it)
self.onmessage = async ({ data }) => {
  if (data.init) { clippers[data.init.mode] = clipper(data.init); return; }
  if (data.cancel) { running.get(data.cancel)?.abort(); return; }
  try {
    if (!clippers[data.mode]) throw new Error(`the ${data.mode} clipper was not set up`);
    const ac = new AbortController();
    running.set(data.seq, ac);
    const value = await clippers[data.mode][data.op](...data.zxy, ac.signal).finally(() => running.delete(data.seq));
    self.postMessage({ seq: data.seq, value }, [value instanceof Float32Array ? value.buffer : value]);
  } catch (err) {
    self.postMessage({ seq: data.seq, error: String(err?.message || err) });
  }
};
