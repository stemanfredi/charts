// Runs clip.js's clipper off the main thread (see workerClipper in clip.js).
import { clipper } from './clip.js';

const clippers = {};
self.onmessage = async ({ data }) => {
  try {
    if (data.init) { clippers[data.init.mode] = clipper(data.init); return; }
    if (!clippers[data.mode]) throw new Error(`the ${data.mode} clipper was not set up`);
    const value = await clippers[data.mode][data.op](...data.zxy);
    self.postMessage({ seq: data.seq, value }, [value instanceof Float32Array ? value.buffer : value]);
  } catch (err) {
    const error = String(err?.message || err);
    self.postMessage(data.init ? { setup: data.init.mode, error } : { seq: data.seq, error });
  }
};
