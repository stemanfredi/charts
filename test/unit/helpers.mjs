// What the unit tests share.
import assert from 'node:assert/strict';

// a and b within tol of each other (what: what they are, for the message)
export const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
