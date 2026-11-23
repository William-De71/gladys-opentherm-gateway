// Test helpers: a clock, a silent logger, waiting, and a fake OpenTherm
// Gateway on a real local socket (test/helpers/fake-otgw.js) that the
// integration reaches through its real code. Nothing leaves 127.0.0.1.

import { FakeOtgw } from './helpers/fake-otgw.js';

export * from './helpers/fake-otgw.js';

export function fakeClock(start = Date.parse('2026-11-23T08:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * @description A started fake gateway.
 * @param {object} [options] - FakeOtgw options.
 * @returns {Promise<FakeOtgw>} Listening on 127.0.0.1.
 */
export const startFake = (options = {}) => new FakeOtgw(options).listen(0, '127.0.0.1');
