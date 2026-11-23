// -----------------------------------------------------------------------------
// TCP client of the OpenTherm Gateway, through its serial port bridged on the
// network: the "Legacy TCP port 25238" of the NodoShop OTGW-firmware (ESP8266
// / ESP32 board), ser2net in raw mode, or any other serial-to-TCP bridge.
//
//   - one connection, kept open: the gateway prints a line for every
//     OpenTherm message (about one a second), each line goes to `onLine`;
//   - commands are sent one at a time (the PIC has a tiny buffer and answers
//     in order): `TT=20.5` waits for `TT: 20.50` or an error code (NG, SE,
//     BV, OR…), 5 s at most, and is sent again twice when nothing comes back
//     (the gateway drops characters when it is busy: `OE`);
//   - a connection that brings no line for a minute is dead (a boiler always
//     talks): it is closed and opened again, 5 s then up to a minute later.
//
// `onState(up, error)` tells the app when the gateway is reached or lost.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { commandLine, OtgwError, parseLine } from './protocol.js';

const DEFAULTS = {
  connectTimeoutMs: 10 * 1000,
  commandTimeoutMs: 5 * 1000,
  attempts: 3,
  silenceMs: 60 * 1000,
  retryMinMs: 5 * 1000,
  retryMaxMs: 60 * 1000,
};
const MAX_LINE = 256;

/**
 * @description Create the client. It connects at once, and again after a loss.
 * @param {object} options - Options.
 * @param {string} options.host - Gateway host.
 * @param {number} options.port - TCP port.
 * @param {Function} options.onLine - `(parsed, raw) => void` for every line.
 * @param {Function} [options.onState] - `(up, error) => void`.
 * @param {Function} [options.trace] - Detailed log.
 * @param {object} [options.timings] - Overrides of DEFAULTS (tests).
 * @param {Function} [options.connect] - `(port, host) => socket` (tests).
 * @returns {object} `{ command, close, connected }`.
 */
export function createClient({
  host,
  port,
  onLine,
  onState = () => {},
  trace = () => {},
  timings = {},
  connect = (p, h) => net.createConnection({ port: p, host: h }),
}) {
  const timing = { ...DEFAULTS, ...timings };
  let socket = null;
  let up = false;
  let closed = false;
  let buffer = '';
  let retryMs = timing.retryMinMs;
  let retryTimer = null;
  let silenceTimer = null;
  let current = null; // { code, line, resolve, reject, timer, attempts }
  const queue = [];

  const setUp = (value, error) => {
    if (up !== value) {
      up = value;
      onState(value, error);
    }
  };

  const failAll = (error) => {
    if (current) {
      clearTimeout(current.timer);
      current.reject(error);
      current = null;
    }
    while (queue.length > 0) {
      queue.shift().reject(error);
    }
  };

  const armSilence = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      trace(`no line for ${Math.round(timing.silenceMs / 1000)} s, reconnecting`);
      drop(new OtgwError('the gateway sends nothing (no OpenTherm traffic)'));
    }, timing.silenceMs);
    silenceTimer.unref?.();
  };

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (closed) {
      return;
    }
    retryTimer = setTimeout(open, retryMs);
    retryTimer.unref?.();
    retryMs = Math.min(retryMs * 2, timing.retryMaxMs);
  }

  function drop(error) {
    clearTimeout(silenceTimer);
    if (socket) {
      socket.removeAllListeners();
      socket.on('error', () => {});
      socket.destroy();
      socket = null;
    }
    buffer = '';
    failAll(error);
    setUp(false, error);
    scheduleRetry();
  }

  function sendNext() {
    if (current || queue.length === 0 || !socket || !up) {
      return;
    }
    current = queue.shift();
    current.attempts += 1;
    trace(`> ${current.line.trim()}`);
    socket.write(current.line);
    current.timer = setTimeout(() => {
      const pending = current;
      current = null;
      if (pending.attempts < timing.attempts) {
        queue.unshift(pending);
      } else {
        pending.reject(
          new OtgwError(`no answer to ${pending.line.trim()}`, { command: pending.code }),
        );
      }
      sendNext();
    }, timing.commandTimeoutMs);
    current.timer.unref?.();
  }

  const settle = (fn) => {
    const pending = current;
    current = null;
    clearTimeout(pending.timer);
    fn(pending);
    sendNext();
  };

  function handleLine(raw) {
    const parsed = parseLine(raw);
    if (!parsed.text && parsed.kind === 'other') {
      return; // empty line
    }
    if (current && parsed.kind === 'reply' && parsed.code === current.code) {
      trace(`< ${raw.trim()}`);
      settle((pending) => pending.resolve(parsed.value));
      return;
    }
    if (current && parsed.kind === 'error') {
      trace(`< ${raw.trim()}`);
      if (parsed.code === 'OE' && current.attempts < timing.attempts) {
        const pending = current;
        current = null;
        clearTimeout(pending.timer);
        queue.unshift(pending);
        sendNext();
        return;
      }
      settle((pending) =>
        pending.reject(
          new OtgwError(`${pending.line.trim()} refused: ${parsed.code} (${parsed.reason})`, {
            code: parsed.code,
            command: pending.code,
          }),
        ),
      );
      return;
    }
    onLine(parsed, raw);
  }

  function open() {
    if (closed || socket) {
      return;
    }
    trace(`connecting to ${host}:${port}`);
    const sock = connect(port, host);
    socket = sock;
    sock.setEncoding?.('latin1');
    sock.setNoDelay?.(true);
    sock.setKeepAlive?.(true, 30 * 1000);
    const connectTimer = setTimeout(
      () => drop(new OtgwError(`connection to ${host}:${port} timed out`)),
      timing.connectTimeoutMs,
    );
    connectTimer.unref?.();
    sock.on('connect', () => {
      clearTimeout(connectTimer);
      retryMs = timing.retryMinMs;
      setUp(true);
      armSilence();
      sendNext();
    });
    sock.on('data', (chunk) => {
      armSilence();
      buffer += chunk;
      const lines = buffer.split(/\r?\n|\r/);
      buffer = lines.pop() ?? '';
      if (buffer.length > MAX_LINE) {
        buffer = ''; // garbage (wrong port, binary protocol): never grow
      }
      for (const line of lines) {
        handleLine(line);
      }
    });
    sock.on('error', (error) => {
      clearTimeout(connectTimer);
      drop(new OtgwError(error.code ? `${error.code} ${host}:${port}` : error.message));
    });
    sock.on('close', () => {
      clearTimeout(connectTimer);
      if (socket === sock) {
        drop(new OtgwError('connection closed by the gateway'));
      }
    });
  }

  open();

  return {
    /**
     * @description Send a command and wait for the gateway to accept it.
     * @param {string} code - Two letters.
     * @param {string|number} value - Value.
     * @returns {Promise<string>} The value the gateway understood (`20.50`).
     */
    command(code, value) {
      if (closed) {
        return Promise.reject(new OtgwError('client closed'));
      }
      if (!up) {
        return Promise.reject(new OtgwError(`not connected to ${host}:${port}`));
      }
      return new Promise((resolve, reject) => {
        queue.push({ code, line: commandLine(code, value), resolve, reject, attempts: 0 });
        sendNext();
      });
    },

    close() {
      closed = true;
      clearTimeout(retryTimer);
      clearTimeout(silenceTimer);
      if (socket) {
        socket.removeAllListeners();
        socket.on('error', () => {});
        socket.destroy();
        socket = null;
      }
      failAll(new OtgwError('client closed'));
      up = false;
    },

    connected: () => up,
  };
}
