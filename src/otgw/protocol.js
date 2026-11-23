// -----------------------------------------------------------------------------
// The OpenTherm Gateway serial protocol, as the gateway prints it (pure, no
// I/O). Written from the firmware documentation of Schelte Bron
// (https://otgw.tclcode.com/firmware.html) and the OpenTherm 2.2 message
// layout; no code copied.
//
// The gateway prints one line per OpenTherm message it sees or sends:
//
//   T80000200   a letter then the 4 bytes of the message, in hexadecimal
//               T  from the thermostat
//               B  from the boiler
//               R  sent to the boiler by the gateway (a modified request)
//               A  sent to the thermostat by the gateway (a modified answer)
//               E  received with a parity or stop bit error (ignored)
//
// The 4 bytes: [parity bit, 3 bits of message type, 4 spare bits] [data id]
// [high data byte] [low data byte].
//
// A command `TT=20.5` is answered `TT: 20.50` (the code, a colon, the value
// the gateway understood) or by one of the error codes below. The gateway
// also prints a few events of its own ("Thermostat disconnected", "Error 02"…).
// -----------------------------------------------------------------------------

export const MESSAGE_TYPES = {
  READ_DATA: 0,
  WRITE_DATA: 1,
  INVALID_DATA: 2,
  RESERVED: 3,
  READ_ACK: 4,
  WRITE_ACK: 5,
  DATA_INVALID: 6,
  UNKNOWN_DATA_ID: 7,
};

// The answers of the gateway to a command it refused.
export const COMMAND_ERRORS = {
  NG: 'unknown command',
  SE: 'syntax error',
  BV: 'bad value',
  OR: 'out of range',
  NS: 'no space',
  NF: 'not found',
  OE: 'overrun error',
};

const MESSAGE_LINE = /^([TBRAE])([0-9A-F]{8})$/i;
const REPLY_LINE = /^([A-Z][A-Z0-9]):\s*(.*)$/;
const EVENTS = [
  [/^Thermostat disconnected/i, 'thermostat_disconnected'],
  [/^Thermostat connected/i, 'thermostat_connected'],
  [/^(Low|Medium|High) power/i, 'power_mode'],
  [/^Error 0?(\d+)/i, 'line_error'],
];

/** The error of a command the gateway refused, or the connection lost. */
export class OtgwError extends Error {
  /**
   * @param {string} message - What went wrong.
   * @param {object} [details] - `{ code, command }`.
   */
  constructor(message, { code = null, command = null } = {}) {
    super(message);
    this.name = 'OtgwError';
    this.code = code;
    this.command = command;
  }
}

/**
 * @description Read one line printed by the gateway.
 * @param {string} raw - The line, without its end of line.
 * @returns {object} One of:
 *   `{ kind: 'message', source, type, id, hi, lo }`,
 *   `{ kind: 'reply', code, value }`,
 *   `{ kind: 'error', code, reason }`,
 *   `{ kind: 'event', event, text }`,
 *   `{ kind: 'other', text }` (nothing to do with it).
 */
export function parseLine(raw) {
  // Control characters: the <ETX> the PIC prints at reset, stray bytes.
  const line = [...String(raw ?? '')]
    .filter((char) => char.charCodeAt(0) >= 0x20)
    .join('')
    .trim();
  const message = MESSAGE_LINE.exec(line);
  if (message) {
    const bytes = Buffer.from(message[2], 'hex');
    return {
      kind: 'message',
      source: message[1].toUpperCase(),
      type: (bytes[0] >> 4) & 0x07,
      id: bytes[1],
      hi: bytes[2],
      lo: bytes[3],
    };
  }
  if (Object.hasOwn(COMMAND_ERRORS, line)) {
    return { kind: 'error', code: line, reason: COMMAND_ERRORS[line] };
  }
  const reply = REPLY_LINE.exec(line);
  if (reply) {
    return { kind: 'reply', code: reply[1], value: reply[2].trim() };
  }
  for (const [pattern, event] of EVENTS) {
    if (pattern.test(line)) {
      return { kind: 'event', event, text: line };
    }
  }
  return { kind: 'other', text: line };
}

/** f8.8: a signed number with 8 bits of fraction (temperatures, %, bar). */
export const f88 = (hi, lo) => {
  const raw = (hi << 8) | lo;
  return (raw >= 0x8000 ? raw - 0x10000 : raw) / 256;
};

/** u16: an unsigned 16-bit integer (counters, hours). */
export const u16 = (hi, lo) => (hi << 8) | lo;

/** s16: a signed 16-bit integer (exhaust temperature). */
export const s16 = (hi, lo) => {
  const raw = (hi << 8) | lo;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
};

/** The bit `bit` of a byte, as 0 or 1. */
export const flag = (byte, bit) => (byte >> bit) & 1;

/**
 * @description A command line for the gateway.
 * @param {string} code - Two letters (`TT`, `SW`…).
 * @param {string|number} value - The value.
 * @returns {string} `TT=20.5\r\n`.
 */
export function commandLine(code, value) {
  if (!/^[A-Z][A-Z0-9]$/.test(code)) {
    throw new OtgwError(`bad command code ${code}`);
  }
  const text = String(value);
  if (!/^[\w.:,+-]{1,16}$/.test(text)) {
    throw new OtgwError(`bad command value ${text}`);
  }
  return `${code}=${text}\r\n`;
}

/**
 * @description A temperature as the gateway expects it (2 decimals at most).
 * @param {number} value - Degrees Celsius.
 * @returns {string} `20.5`, `-3.25`.
 */
export function temperatureValue(value) {
  return String(Math.round(Number(value) * 100) / 100);
}

/**
 * @description The firmware version of a `PR: A=…` answer.
 * @param {string} value - `A=OpenTherm Gateway 6.5`.
 * @returns {string|null} `6.5`.
 */
export function parseAbout(value) {
  const match = /OpenTherm Gateway\s+([\w.]+)/i.exec(String(value ?? ''));
  return match ? match[1] : null;
}

/**
 * @description The mode of a `PR: M=…` answer.
 * @param {string} value - `M=G` (gateway) or `M=M` (monitor).
 * @returns {'gateway'|'monitor'|null} The mode.
 */
export function parseMode(value) {
  const match = /^M=([GM])/i.exec(String(value ?? ''));
  if (!match) {
    return null;
  }
  return match[1].toUpperCase() === 'G' ? 'gateway' : 'monitor';
}
