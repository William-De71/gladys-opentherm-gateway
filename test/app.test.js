// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and a fake OpenTherm Gateway
// on a real local socket: identification, discovery from the traffic, states,
// commands and their guards, scene triggers and actions, widgets, gateway
// lost and back. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { SCENE_ACTION_OUTPUTS, SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import {
  boilerValue,
  fakeClock,
  line,
  MESSAGE_TYPES,
  silentLogger,
  startFake,
  status,
  TRAFFIC,
  until,
} from './helpers.js';

const PREFIX = 'ext:test-integration';
const BOILER = `${PREFIX}:boiler:otgw`;
const THERMOSTAT = `${PREFIX}:thermostat:otgw`;
const feature = (device, key) => `${device}:${key}`;

/**
 * @description An integration wired to the fake Gladys and a fake gateway.
 * @param {object} [options] - `{ config, fakeOptions, storage, traffic, create }`.
 * @returns {Promise<object>} Helpers.
 */
async function setup({
  config = {},
  fakeOptions = {},
  storage = memoryStorage(),
  traffic = TRAFFIC,
  create = true,
} = {}) {
  const otgw = await startFake(fakeOptions);
  const gladys = createFakeGladys({
    config: { host: otgw.host, port: otgw.port, language: 'fr', ...config },
  });
  const clock = fakeClock();
  const app = createApp(gladys, {
    storage,
    now: clock.now,
    logger: silentLogger,
    timings: {
      sampleMs: 60 * 60 * 1000, // flushed by hand
      discoveryDelayMs: 10,
      faultDelayMs: 10,
      checkMs: 60 * 60 * 1000, // checked by hand
      widgetSpacingMs: 0,
    },
    clientTimings: { retryMinMs: 30, retryMaxMs: 60, commandTimeoutMs: 200 },
  });
  await gladys.connect();
  await app.start();
  await until(() => otgw.commands.includes('PS=0'));
  const devices = () => gladys.fake.discoveredDevices;
  if (traffic.length > 0) {
    otgw.send(...traffic);
    const last = Number.parseInt(traffic.at(-1).slice(3, 5), 16);
    await until(() => app.seen().has(last));
    await until(() =>
      devices().some((device) =>
        device.features.some((item) => item.external_id.endsWith(':burner_hours')),
      ),
    );
  }
  if (create) {
    for (const device of devices()) {
      await gladys.fake.deviceCreated(device);
    }
  }
  const flush = async () => {
    app.flushSamples();
    await app.flushStates();
  };
  return {
    gladys,
    otgw,
    app,
    clock,
    storage,
    devices,
    flush,
    device: (externalId) => devices().find((item) => item.external_id === externalId),
    featureOf: (deviceId, key) =>
      devices()
        .find((item) => item.external_id === deviceId)
        ?.features.find((item) => item.external_id === feature(deviceId, key)),
    async stop() {
      await app.stop();
      await otgw.close();
    },
  };
}

test('identification: firmware, mode, one line per message; status connected', async () => {
  const ctx = await setup();
  try {
    assert.deepEqual(ctx.otgw.commands.slice(0, 3), ['PR=A', 'PR=M', 'PS=0']);
    await until(() => ctx.gladys.fake.connectionStatus?.message?.en.includes('6.8'));
    assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  } finally {
    await ctx.stop();
  }
});

test('discovery: the data ids seen make the features, valid for Gladys', async () => {
  const ctx = await setup();
  try {
    const boiler = ctx.device(BOILER);
    const thermostat = ctx.device(THERMOSTAT);
    assert.equal(boiler.name, 'Chaudière');
    assert.equal(boiler.model, 'OpenTherm Gateway 6.8');
    assert.equal(boiler.should_poll, false);
    assert.equal(boiler.poll_frequency, undefined);
    const keys = boiler.features.map((item) => item.external_id.split(':').pop());
    assert.deepEqual(keys, [
      'flame',
      'ch_active',
      'dhw_active',
      'fault',
      'modulation',
      'flow_temperature',
      'return_temperature',
      'control_setpoint',
      'pressure',
      'dhw_temperature',
      'dhw_enable',
      'burner_starts',
      'burner_hours',
    ]);
    assert.deepEqual(
      thermostat.features.map((item) => item.external_id.split(':').pop()),
      ['room_temperature', 'room_setpoint'],
    );
    for (const device of ctx.devices()) {
      for (const item of device.features) {
        for (const field of ['category', 'type', 'min', 'max', 'read_only', 'has_feedback']) {
          assert.notEqual(item[field], undefined, `${item.external_id} ${field}`);
        }
        assert.ok(item.name.length > 0);
      }
    }
    const setpoint = ctx.featureOf(THERMOSTAT, 'room_setpoint');
    assert.equal(setpoint.category, 'thermostat');
    assert.equal(setpoint.type, 'target-temperature');
    assert.equal(setpoint.read_only, false);
    assert.deepEqual(await ctx.storage.read('seen.json'), {
      ids: [0, 1, 17, 18, 25, 26, 28, 16, 24, 116, 120],
    });
  } finally {
    await ctx.stop();
  }
});

test('discovery: a new data id adds its feature; unknown ids are ignored', async () => {
  const ctx = await setup();
  try {
    ctx.otgw.send(
      boilerValue(27, -3.5),
      line('B', MESSAGE_TYPES.UNKNOWN_DATA_ID, 33, 0, 0),
      boilerValue(99, 1),
    );
    await until(() => ctx.featureOf(BOILER, 'outside_temperature'));
    assert.equal(ctx.featureOf(BOILER, 'exhaust_temperature'), undefined);
    assert.equal(ctx.app.seen().has(99), false);
  } finally {
    await ctx.stop();
  }
});

test('restart: the data ids saved give the same devices before any traffic', async () => {
  const storage = memoryStorage({ 'seen.json': { ids: [0, 25, 24, 16, 999] } });
  const ctx = await setup({ storage, traffic: [], create: false });
  try {
    await until(() => ctx.devices().length === 2);
    assert.ok(ctx.featureOf(BOILER, 'flow_temperature'));
    assert.ok(ctx.featureOf(THERMOSTAT, 'room_setpoint'));
  } finally {
    await ctx.stop();
  }
});

test('states: rounded values of the created devices, binaries at once, numbers sampled', async () => {
  const ctx = await setup();
  try {
    await ctx.flush();
    const state = (device, key) => ctx.gladys.fake.lastState(feature(device, key));
    assert.equal(state(BOILER, 'flame'), 1);
    assert.equal(state(BOILER, 'ch_active'), 1);
    assert.equal(state(BOILER, 'dhw_enable'), 1);
    assert.equal(state(BOILER, 'flow_temperature'), 52.3);
    assert.equal(state(BOILER, 'return_temperature'), 41.7);
    assert.equal(state(BOILER, 'modulation'), 48);
    assert.equal(state(BOILER, 'pressure'), 1.6);
    assert.equal(state(BOILER, 'burner_starts'), 12345);
    assert.equal(state(THERMOSTAT, 'room_temperature'), 19.6);
    assert.equal(state(THERMOSTAT, 'room_setpoint'), 20.5);

    // A flow temperature every second: only the sample reaches Gladys.
    const before = ctx.gladys.fake.states.length;
    ctx.otgw.send(boilerValue(25, 52.4), boilerValue(25, 52.5), boilerValue(25, 52.6));
    await until(() => ctx.app.raw.get('flow_temperature') > 52.59);
    await ctx.app.flushStates();
    assert.equal(ctx.gladys.fake.states.length, before, 'nothing until the sample');
    await ctx.flush();
    assert.equal(state(BOILER, 'flow_temperature'), 52.6);
    assert.equal(ctx.gladys.fake.states.length, before + 1);

    // The flame goes out: at once.
    ctx.otgw.send(status({ ch: 1, flame: 0 }));
    await until(() => ctx.app.raw.get('flame') === 0);
    await ctx.app.flushStates();
    assert.equal(state(BOILER, 'flame'), 0);
  } finally {
    await ctx.stop();
  }
});

test('room setpoint: TT (temporary) or TC (constant), bounded, shown at once', async () => {
  const ctx = await setup();
  try {
    const thermostat = ctx.device(THERMOSTAT);
    const setpoint = ctx.featureOf(THERMOSTAT, 'room_setpoint');
    let ack = await ctx.gladys.fake.setValue(thermostat, setpoint, 21.3);
    assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.otgw.commands.includes('TT=21.5'), 'rounded to the 0.5 step');
    await ctx.app.flushStates();
    assert.equal(ctx.gladys.fake.lastState(setpoint.external_id), 21.5);

    ack = await ctx.gladys.fake.setValue(thermostat, setpoint, 40);
    assert.equal(ack.success, false);
    assert.match(ack.error, /entre 5 et 30/);

    await ctx.gladys.fake.configUpdated({
      host: ctx.otgw.host,
      port: ctx.otgw.port,
      language: 'fr',
      override_mode: 'constant',
    });
    ack = await ctx.gladys.fake.setValue(thermostat, setpoint, 19);
    assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.otgw.commands.includes('TC=19'));
  } finally {
    await ctx.stop();
  }
});

test('hot water: setpoint spaced and never twice, on/off with HW', async () => {
  const ctx = await setup({ traffic: [...TRAFFIC, boilerValue(56, 55)] });
  try {
    const boiler = ctx.device(BOILER);
    const target = ctx.featureOf(BOILER, 'dhw_setpoint');
    assert.equal(target.category, 'water-heater');
    let ack = await ctx.gladys.fake.setValue(boiler, target, 52);
    assert.equal(ack.success, true, ack.error);
    assert.equal(ctx.otgw.commands.filter((item) => item === 'SW=52').length, 1);
    ack = await ctx.gladys.fake.setValue(boiler, target, 52);
    assert.equal(ack.success, true, 'the same value: nothing sent');
    assert.equal(ctx.otgw.commands.filter((item) => item === 'SW=52').length, 1);
    ack = await ctx.gladys.fake.setValue(boiler, target, 50);
    assert.equal(ack.success, false, 'a minute between two changes');
    assert.match(ack.error, /réessayez dans 60 s/);
    ctx.clock.advance(61 * 1000);
    ack = await ctx.gladys.fake.setValue(boiler, target, 50);
    assert.equal(ack.success, true, ack.error);
    ack = await ctx.gladys.fake.setValue(boiler, target, 80);
    assert.equal(ack.success, false);

    ack = await ctx.gladys.fake.setValue(boiler, ctx.featureOf(BOILER, 'dhw_enable'), 0);
    assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.otgw.commands.includes('HW=0'));

    ack = await ctx.gladys.fake.setValue(boiler, ctx.featureOf(BOILER, 'flame'), 1);
    assert.equal(ack.success, false, 'a sensor is read only');
  } finally {
    await ctx.stop();
  }
});

test('monitor mode: Gladys reads, every command is refused before the gateway', async () => {
  const ctx = await setup({ fakeOptions: { mode: 'M' } });
  try {
    await until(() => ctx.gladys.fake.connectionStatus?.message?.en.includes('monitor'));
    const ack = await ctx.gladys.fake.setValue(
      ctx.device(THERMOSTAT),
      ctx.featureOf(THERMOSTAT, 'room_setpoint'),
      21,
    );
    assert.equal(ack.success, false);
    assert.match(ack.error, /mode moniteur/);
    assert.ok(!ctx.otgw.commands.some((item) => item.startsWith('TT=')));
  } finally {
    await ctx.stop();
  }
});

test('scene actions: override, outside temperature, hot water, max flow; outputs declared', async () => {
  const ctx = await setup();
  try {
    const run = async (key, fields) => {
      const ack = await ctx.gladys.fake.sceneAction(key, fields);
      if (ack.success) {
        assert.deepEqual(
          Object.keys(ack.data.outputs ?? ack.data ?? {}),
          SCENE_ACTION_OUTPUTS[key],
        );
      }
      return ack;
    };
    let ack = await run('set_room_override', { temperature: 20, mode: 'constant' });
    assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.otgw.commands.includes('TC=20'));
    assert.equal((ack.data.outputs ?? ack.data).result, '20.00');
    assert.equal((await run('cancel_room_override')).success, true);
    assert.ok(ctx.otgw.commands.includes('TT=0'));
    assert.equal((await run('set_outside_temperature', { temperature: 7.46 })).success, true);
    assert.ok(ctx.otgw.commands.includes('OT=7.5'));
    assert.equal((await run('set_outside_temperature', { temperature: 80 })).success, false);
    assert.equal((await run('clear_outside_temperature')).success, true);
    assert.ok(ctx.otgw.commands.includes('OT=-'));
    assert.equal((await run('set_hot_water', { mode: 'thermostat' })).success, true);
    assert.ok(ctx.otgw.commands.includes('HW=T'));
    assert.equal((await run('set_hot_water', { mode: 'boost' })).success, false);
    assert.equal((await run('set_max_flow_temperature', { temperature: 95 })).success, false);
    assert.equal((await run('set_max_flow_temperature', { temperature: 0 })).success, true);
    assert.ok(ctx.otgw.commands.includes('SH=0'));
  } finally {
    await ctx.stop();
  }
});

test('a command the gateway refuses or never answers fails with a clear message', async () => {
  const ctx = await setup({ fakeOptions: { refuse: { OT: 'OR' }, silent: new Set(['SH']) } });
  try {
    let ack = await ctx.gladys.fake.sceneAction('set_outside_temperature', { temperature: 5 });
    assert.equal(ack.success, false);
    assert.match(ack.error, /refusé la commande \(OR\)/);
    ack = await ctx.gladys.fake.sceneAction('set_max_flow_temperature', { temperature: 60 });
    assert.equal(ack.success, false);
    assert.equal(ctx.otgw.commands.filter((item) => item === 'SH=60').length, 3, 'sent 3 times');
    assert.match(ack.error, /ne répond pas/);
  } finally {
    await ctx.stop();
  }
});

test('scene triggers: boiler fault with its code, cleared, service request; never the first value', async () => {
  const ctx = await setup({ traffic: [...TRAFFIC, status({ fault: 1 })] });
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ctx.gladys.fake.sceneEvents.length, 0, 'the first value is not news');
    ctx.otgw.send(status({ fault: 0 }));
    await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'boiler_fault_cleared'));
    ctx.otgw.send(
      line('B', MESSAGE_TYPES.READ_ACK, 5, 0b0000_0100, 0),
      status({ fault: 1 }),
      line('B', MESSAGE_TYPES.READ_ACK, 5, 0b0000_0101, 28),
    );
    await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'boiler_fault'));
    const fault = ctx.gladys.fake.sceneEvents.find((e) => e.key === 'boiler_fault');
    assert.equal(fault.data.oem_fault_code, 28);
    assert.equal(fault.data.low_water_pressure, true);
    assert.equal(fault.data.gas_flame_fault, false);
    assert.match(fault.data.faults, /Code 28 · low water pressure/);
    const service = ctx.gladys.fake.sceneEvents.find((e) => e.key === 'service_requested');
    assert.equal(service?.data.oem_fault_code, 28);
    for (const event of ctx.gladys.fake.sceneEvents) {
      assert.deepEqual(
        Object.keys(event.data).sort(),
        [...SCENE_TRIGGER_DATA[event.key]].sort(),
        event.key,
      );
    }
    await ctx.flush();
    assert.match(
      ctx.gladys.fake.lastState(feature(BOILER, 'fault_details')),
      /Code 28 · pression d’eau basse/,
    );
    const widget = await ctx.gladys.fake.widgetGet('boiler', { language: 'de' });
    const content = widget.data.content ?? widget.data;
    assert.deepEqual(validateWidgetContent(content), []);
    const statusItems = content.components.find((item) => item.type === 'status').items;
    assert.equal(statusItems[0].color, 'danger');
    assert.match(statusItems[0].value.de, /Wasserdruck zu niedrig/);
  } finally {
    await ctx.stop();
  }
});

test('thermostat disconnected, gateway lost for 3 minutes then back', async () => {
  const ctx = await setup();
  try {
    ctx.otgw.send('Thermostat disconnected');
    await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'thermostat_disconnected'));
    await ctx.otgw.close();
    await until(() => ctx.gladys.fake.connectionStatus?.connected === false);
    assert.ok(ctx.gladys.fake.transports.some((item) => item.transport === 'unreachable'));
    ctx.app.checkOffline();
    assert.ok(!ctx.gladys.fake.sceneEvents.some((e) => e.key === 'gateway_offline'));
    ctx.clock.advance(3 * 60 * 1000);
    ctx.app.checkOffline();
    await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'gateway_offline'));
    const offline = ctx.gladys.fake.sceneEvents.find((e) => e.key === 'gateway_offline');
    assert.equal(offline.data.address, `${ctx.otgw.host}:${ctx.otgw.port}`);
    await ctx.otgw.listen(ctx.otgw.port, ctx.otgw.host);
    await until(() => ctx.gladys.fake.sceneEvents.some((e) => e.key === 'gateway_online'), 5000);
    assert.equal(ctx.gladys.fake.transports.at(-1).transport, 'local');
  } finally {
    await ctx.app.stop();
    await ctx.otgw.close().catch(() => {});
  }
});

test('widgets: valid contents, live tiles, the override button cancels it', async () => {
  const ctx = await setup({ traffic: [...TRAFFIC, line('A', MESSAGE_TYPES.READ_ACK, 9, 21, 0)] });
  try {
    const get = async (key, settings) => {
      const ack = await ctx.gladys.fake.widgetGet(key, { settings, language: 'fr' });
      assert.equal(ack.success, true, ack.error);
      return ack.data.content ?? ack.data;
    };
    const boiler = await get('boiler');
    assert.deepEqual(validateWidgetContent(boiler), []);
    const tiles = boiler.components.filter((item) => item.type === 'value');
    assert.equal(tiles.length, 6);
    assert.equal(tiles[0].device_feature, feature(BOILER, 'flow_temperature'));
    const button = boiler.components.find((item) => item.type === 'button');
    assert.equal(button.action.key, 'cancel_override');
    const history = await get('history', { period: 'last-week' });
    assert.deepEqual(validateWidgetContent(history), []);
    assert.equal(history.components[0].device_features.length, 4);
    const ack = await ctx.gladys.fake.widgetAction('boiler', 'cancel_override');
    assert.equal(ack.success, true, ack.error);
    assert.ok(ctx.otgw.commands.includes('TT=0'));
    const after = await get('boiler');
    assert.equal(
      after.components.find((item) => item.type === 'button'),
      undefined,
    );
  } finally {
    await ctx.stop();
  }
});

test('configuration button: firmware, mode and the values seen', async () => {
  const ctx = await setup();
  try {
    const ack = await ctx.gladys.fake.action('test_connection');
    assert.equal(ack.success, true, ack.error);
    const message = ack.data.message ?? ack.data;
    assert.match(message.fr, /OpenTherm Gateway 6\.8 trouvée/);
    assert.match(message.fr, /Mode passerelle/);
    assert.match(message.en, /Flow temperature/);
  } finally {
    await ctx.stop();
  }
});

test('no address: a status that says so, empty widgets, nothing published', async () => {
  const gladys = createFakeGladys({ config: { host: '' } });
  const app = createApp(gladys, { storage: memoryStorage(), logger: silentLogger });
  await gladys.connect();
  await app.start();
  try {
    await until(() => gladys.fake.connectionStatus !== null);
    assert.equal(gladys.fake.connectionStatus.connected, false);
    assert.equal(gladys.fake.discoveredDevices.length, 0);
    const ack = await gladys.fake.widgetGet('boiler');
    assert.deepEqual(validateWidgetContent(ack.data.content ?? ack.data), []);
    const action = await gladys.fake.sceneAction('cancel_room_override');
    assert.equal(action.success, false);
  } finally {
    await app.stop();
  }
});
