// Runs clip.js's clipper off the main thread (see workerClipper in clip.js).
import { clipper } from './clip.js';

const clippers = {};
self.onmessage = async ({ data }) => {
  if (data.init) {
    const o = data.init;
    clippers[o.mode] = clipper({ ...o, onStale: () => self.postMessage({ stale: o.mode }) });
    return;
  }
  try {
    const value = await clippers[data.mode][data.op](...data.zxy);
    self.postMessage({ seq: data.seq, value }, [value instanceof Float32Array ? value.buffer : value]);
  } catch (err) {
    self.postMessage({ seq: data.seq, error: String(err?.message || err) });
  }
};
