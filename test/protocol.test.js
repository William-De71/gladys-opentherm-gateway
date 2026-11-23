// The pure parts: gateway lines, OpenTherm values, which lines carry a value,
// the features of the data ids seen, the client against a fake gateway.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, featuresFor, FEATURES, toState, valuesOf } from '../src/otgw/opentherm.js';
import {
  commandLine,
  f88,
  parseAbout,
  parseLine,
  parseMode,
  s16,
  temperatureValue,
} from '../src/otgw/protocol.js';
import { createClient } from '../src/otgw/client.js';
import { normalizeConfig, parseAddress } from '../src/config.js';
import { boilerValue, line, MESSAGE_TYPES, startFake, status, until } from './helpers.js';

test('parseLine: messages, replies, errors, events', () => {
  assert.deepEqual(parseLine('B40190A00\r'), {
    kind: 'message',
    source: 'B',
    type: 4,
    id: 25,
    hi: 10,
    lo: 0,
  });
  // The parity bit (bit 7) does not change the type.
  assert.equal(parseLine('T90100F00').type, MESSAGE_TYPES.WRITE_DATA);
  assert.deepEqual(parseLine('TT: 20.50'), { kind: 'reply', code: 'TT', value: '20.50' });
  assert.deepEqual(parseLine('PR: A=OpenTherm Gateway 6.8'), {
    kind: 'reply',
    code: 'PR',
    value: 'A=OpenTherm Gateway 6.8',
  });
  assert.deepEqual(parseLine('OR'), { kind: 'error', code: 'OR', reason: 'out of range' });
  assert.equal(parseLine('Thermostat disconnected').event, 'thermostat_disconnected');
  assert.equal(parseLine('Thermostat connected').event, 'thermostat_connected');
  assert.equal(parseLine('Error 02').event, 'line_error');
  assert.equal(parseLine('\u0003').kind, 'other');
  assert.equal(parseLine('E40190A00').source, 'E');
});

test('numbers: f8.8, s16, firmware, mode, command lines', () => {
  assert.equal(f88(0x0a, 0x80), 10.5);
  assert.equal(f88(0xfc, 0x80), -3.5);
  assert.equal(s16(0xff, 0xfe), -2);
  assert.equal(parseAbout('A=OpenTherm Gateway 6.5'), '6.5');
  assert.equal(parseAbout('A=something else'), null);
  assert.equal(parseMode('M=G'), 'gateway');
  assert.equal(parseMode('M=M'), 'monitor');
  assert.equal(commandLine('TT', '20.5'), 'TT=20.5\r\n');
  assert.throws(() => commandLine('TT', '20\r\nGW=R'));
  assert.throws(() => commandLine('tt', '1'));
  assert.equal(temperatureValue(20.456), '20.46');
});

test('classify: boiler answers and thermostat writes carry values', () => {
  const at = (raw) => classify(parseLine(raw));
  assert.equal(at(boilerValue(25, 50)), 'value');
  assert.equal(at(line('A', MESSAGE_TYPES.READ_ACK, 9, 21, 0)), 'value');
  assert.equal(at(line('T', MESSAGE_TYPES.WRITE_DATA, 24, 20, 0)), 'value');
  assert.equal(at(line('T', MESSAGE_TYPES.READ_DATA, 25, 0, 0)), null, 'a question');
  assert.equal(at(line('B', MESSAGE_TYPES.UNKNOWN_DATA_ID, 18, 0, 0)), 'unsupported');
  assert.equal(at(line('B', MESSAGE_TYPES.DATA_INVALID, 18, 0, 0)), null);
  assert.equal(at('E40190A00'), null);
});

test('valuesOf: status bits, faults, override, counters', () => {
  const values = (raw) => Object.fromEntries(valuesOf(parseLine(raw)));
  assert.deepEqual(values(status({ dhwEnable: 0, ch: 1, flame: 1, fault: 1 })), {
    flame: 1,
    ch_active: 1,
    dhw_active: 0,
    fault: 1,
    dhw_enable: 0,
    ch_enable: 1,
  });
  const faults = values(line('B', MESSAGE_TYPES.READ_ACK, 5, 0b0010_0001, 42)).faults;
  assert.equal(faults.oem, 42);
  assert.equal(faults.flags.service_request, true);
  assert.equal(faults.flags.water_over_temperature, true);
  assert.equal(faults.flags.low_water_pressure, false);
  assert.deepEqual(values(line('A', MESSAGE_TYPES.READ_ACK, 9, 0, 0)), {
    override_setpoint: 0,
    override_active: 0,
  });
  assert.deepEqual(values(line('B', MESSAGE_TYPES.READ_ACK, 116, 0x30, 0x39)), {
    burner_starts: 12345,
  });
  assert.deepEqual(values(line('B', MESSAGE_TYPES.READ_ACK, 33, 0x00, 0x4b)), {
    exhaust_temperature: 75,
  });
});

test('features: unique keys, complete fields, rounding and sensor range', () => {
  const keys = FEATURES.map((feature) => feature.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const feature of FEATURES) {
    for (const field of ['category', 'type', 'min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(feature.shape[field], undefined, `${feature.key} ${field}`);
    }
    assert.equal(feature.shape.read_only, !feature.writable, feature.key);
  }
  const flow = FEATURES.find((feature) => feature.key === 'flow_temperature');
  assert.equal(toState(flow, 52.31), 52.3);
  assert.equal(toState(flow, -273), null, 'a missing sensor');
  assert.deepEqual(
    featuresFor(new Set([24])).map((feature) => feature.key),
    ['room_temperature'],
  );
});

test('config: addresses as users type them', () => {
  assert.deepEqual(parseAddress('socket://192.168.1.40:25238', 1), {
    host: '192.168.1.40',
    port: 25238,
  });
  assert.deepEqual(parseAddress('otgw.local:7686', 25238), { host: 'otgw.local', port: 7686 });
  assert.deepEqual(parseAddress('[fd00::5]', 99999), { host: 'fd00::5', port: 25238 });
  assert.equal(normalizeConfig({ override_mode: 'x' }).overrideMode, 'temporary');
  assert.equal(normalizeConfig({ debug_logs: 'true' }).debugLogs, true);
});

test('client: lines, a command answered, retries on OE, reconnects', async () => {
  const fake = await startFake({ refuse: {} });
  const lines = [];
  const states = [];
  const client = createClient({
    host: fake.host,
    port: fake.port,
    onLine: (parsed) => lines.push(parsed),
    onState: (up) => states.push(up),
    timings: { retryMinMs: 20, retryMaxMs: 40, commandTimeoutMs: 200 },
  });
  try {
    await until(() => client.connected());
    assert.equal(await client.command('TT', '20.5'), '20.50');
    fake.send(boilerValue(25, 40), 'garbage');
    await until(() => lines.length === 2);
    assert.equal(lines[0].id, 25);
    fake.refuse.SW = 'OE';
    await assert.rejects(client.command('SW', '50'), /OE/);
    assert.equal(fake.commands.filter((item) => item === 'SW=50').length, 3);
    fake.dropClients();
    await until(() => states.includes(false));
    await until(() => client.connected());
    assert.deepEqual(states.slice(0, 3), [true, false, true]);
  } finally {
    client.close();
    await fake.close();
  }
  await assert.rejects(client.command('TT', '0'), /closed/);
});
