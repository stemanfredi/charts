// What the browser tests share (smoke.mjs, ui.mjs, tiles-check.mjs): the site served, headless
// Chrome launched, check() that prints and counts, section() that keeps one thrown error from
// skipping everything after it, finish() that closes and exits with the count.
//   CHROME=/path/to/chrome     the browser (default: /usr/bin/google-chrome)
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';

export async function start() {
  const server = await serve();
  const browser = await chromium.launch(chromeOptions());
  const failures = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
  // a part of a run on its own: an error thrown in it is one failure, and the next part runs
  const section = async (name, fn) => {
    try { await fn(); } catch (err) {
      const where = err.stack?.split('\n').find((l) => /test\/\w+\.mjs/.test(l))?.trim();
      check(false, `${name} crashed: ${err.message.split('\n').filter((l) => l.trim()).slice(0, 6).map((l) => l.trim()).join(' / ')}${where ? ` (${where})` : ''}`);
    }
  };
  const finish = async () => {
    await browser.close();
    server.close();
    console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
    process.exit(failures.length ? 1 : 0);
  };
  return { server, browser, base: server.url, check, section, finish };
}
