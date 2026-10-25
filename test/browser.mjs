// What the browser tests share (smoke.mjs, ui.mjs, tiles-check.mjs): the site served, headless
// Chrome launched, check() that prints and counts, section() that keeps one thrown error from
// skipping everything after it, finish() that closes and exits with the count.
// A check of what a provider served (check(ok, what, true): a tile, a legend, a place found) fails
// the run only with STRICT=1 (the weekly run, ci.yml): on a push it is said, listed and shown as a
// warning in GitHub Actions, and the deploy is not held up by a provider's bad day.
//   CHROME=/path/to/chrome     the browser (default: /usr/bin/google-chrome)
//   STRICT=1                   a provider's failure fails the run too
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from './serve.mjs';

export async function start() {
  const server = await serve();
  const browser = await chromium.launch(chromeOptions());
  const failures = [], advisories = [], strict = process.env.STRICT === '1';
  const check = (ok, what, provider = false) => {
    console.log(`${ok ? 'ok  ' : provider ? 'FAIL~' : 'FAIL'}  ${what}`);
    if (!ok) (provider ? advisories : failures).push(what);
  };
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
    if (advisories.length) {
      console.log(`\n${advisories.length} of what providers served failed (FAIL~)${strict ? '' : ': not held against the page'}:\n  ${advisories.join('\n  ')}`);
      if (process.env.GITHUB_ACTIONS) for (const a of advisories) console.log(`::warning title=Provider::${a.replace(/\n/g, ' ')}`);
    }
    const failed = failures.length + (strict ? advisories.length : 0);
    console.log(failed ? `\n${failed} failed` : `\nall passed${advisories.length ? ' (the page\'s own checks)' : ''}`);
    process.exit(failed ? 1 : 0);
  };
  return { server, browser, base: server.url, check, section, finish };
}
