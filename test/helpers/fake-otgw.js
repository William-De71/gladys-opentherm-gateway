// A fake OpenTherm Gateway on a real local socket: it answers the commands
// the way the firmware documentation describes (`TT=20.5` -> `TT: 20.50`,
// error codes NG, SE, BV, OR…), and the tests make it print OpenTherm
// message lines (`B40190A00`) as a gateway between a thermostat and a boiler
// would. Nothing starts on import (node --test also runs this file).

import net from 'node:net';

const TYPES = { READ_DATA: 0, WRITE_DATA: 1, READ_ACK: 4, WRITE_ACK: 5, UNKNOWN_DATA_ID: 7 };

const hex = (byte) => byte.toString(16).toUpperCase().padStart(2, '0');

/**
 * @description An OpenTherm message line.
 * @param {string} source - T, B, R, A.
 * @param {number} type - Message type (0…7).
 * @param {number} id - Data id.
 * @param {number} hi - High data byte.
 * @param {number} lo - Low data byte.
 * @returns {string} `B40190A00`.
 */
export const line = (source, type, id, hi, lo) =>
  `${source}${hex(type << 4)}${hex(id)}${hex(hi)}${hex(lo)}`;

/** f8.8 bytes of a number. */
export const f88Bytes = (value) => {
  const raw = Math.round(value * 256) & 0xffff;
  return [raw >> 8, raw & 0xff];
};

/** A boiler Read-Ack carrying an f8.8 value. */
export const boilerValue = (id, value) => line('B', TYPES.READ_ACK, id, ...f88Bytes(value));

/** A boiler Read-Ack carrying a u16. */
export const boilerCount = (id, value) => line('B', TYPES.READ_ACK, id, value >> 8, value & 0xff);

/**
 * @description The status exchange (data id 0) as the boiler answers it.
 * @param {object} flags - `{ chEnable, dhwEnable, fault, ch, dhw, flame }` (booleans).
 * @returns {string} The B line.
 */
export const status = ({ chEnable = 1, dhwEnable = 1, fault = 0, ch = 0, dhw = 0, flame = 0 }) =>
  line(
    'B',
    TYPES.READ_ACK,
    0,
    (chEnable ? 1 : 0) | (dhwEnable ? 2 : 0),
    (fault ? 1 : 0) | (ch ? 2 : 0) | (dhw ? 4 : 0) | (flame ? 8 : 0),
  );

/** A thermostat Write-Data carrying an f8.8 value (room temperature, setpoint). */
export const thermostatWrite = (id, value) => line('T', TYPES.WRITE_DATA, id, ...f88Bytes(value));

export const MESSAGE_TYPES = TYPES;

/** The typical traffic of a boiler heating the house. */
export const TRAFFIC = [
  status({ ch: 1, flame: 1 }),
  boilerValue(1, 55),
  boilerValue(17, 47.5),
  boilerValue(18, 1.6),
  boilerValue(25, 52.31),
  boilerValue(26, 48),
  boilerValue(28, 41.7),
  thermostatWrite(16, 20.5),
  thermostatWrite(24, 19.62),
  boilerCount(116, 12345),
  boilerCount(120, 4321),
];

export class FakeOtgw {
  /**
   * @param {object} [options] - `{ mode: 'G'|'M', firmware, refuse: { CODE: 'NG' }, silent: Set<CODE> }`.
   */
  constructor({ mode = 'G', firmware = '6.8', refuse = {}, silent = new Set() } = {}) {
    this.mode = mode;
    this.firmware = firmware;
    this.refuse = refuse;
    this.silent = silent;
    this.commands = [];
    this.sockets = new Set();
    this.server = net.createServer((socket) => this.#accept(socket));
  }

  #accept(socket) {
    this.sockets.add(socket);
    socket.setEncoding('latin1');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop();
      for (const raw of lines.filter(Boolean)) {
        this.commands.push(raw);
        const answer = this.#answer(raw);
        if (answer) {
          socket.write(`${answer}\r\n`);
        }
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
  }

  #answer(raw) {
    const match = /^([A-Z][A-Z0-9])=(.*)$/.exec(raw);
    if (!match) {
      return 'SE';
    }
    const [, code, value] = match;
    if (this.silent.has(code)) {
      return null;
    }
    if (this.refuse[code]) {
      return this.refuse[code];
    }
    if (code === 'PR') {
      if (value === 'A') {
        return `PR: A=OpenTherm Gateway ${this.firmware}`;
      }
      if (value === 'M') {
        return `PR: M=${this.mode}`;
      }
      return 'BV';
    }
    if (['TT', 'TC', 'SW', 'SH', 'OT'].includes(code)) {
      if (value === '-') {
        return `${code}: -`;
      }
      const number = Number(value);
      return Number.isFinite(number) ? `${code}: ${number.toFixed(2)}` : 'BV';
    }
    if (['HW', 'PS'].includes(code)) {
      return `${code}: ${value}`;
    }
    return 'NG';
  }

  /** Print lines to every connected client. */
  send(...lines) {
    for (const socket of this.sockets) {
      socket.write(lines.map((item) => `${item}\r\n`).join(''));
    }
  }

  /** Drop every connection (the board rebooting). */
  dropClients() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  get clients() {
    return this.sockets.size;
  }

  async listen(port = 0, host = '127.0.0.1') {
    await new Promise((resolve) => this.server.listen(port, host, resolve));
    this.host = host;
    this.port = this.server.address().port;
    return this;
  }

  async close() {
    this.dropClients();
    await new Promise((resolve) => this.server.close(resolve));
  }
}
