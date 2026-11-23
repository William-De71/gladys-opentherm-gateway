// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   connection  one TCP connection to the gateway (src/otgw/client.js);
//               at each connection: PR=A (firmware), PR=M (gateway or
//               monitor mode), PS=0 (one line per OpenTherm message)
//   readings    every OpenTherm message the gateway prints carries a value
//               (src/otgw/opentherm.js): binary ones (flame, hot water…) go
//               to Gladys at once, numbers at most every 15 s (the flow
//               temperature changes every second)
//   discovery   the data ids seen with a value make the features of the
//               boiler and thermostat devices; kept in /data/seen.json so a
//               restart does not shrink the devices before the traffic
//               comes back; published again when a new id shows up
//   commands    room setpoint (TT or TC), hot water setpoint (SW), hot water
//               on/off (HW): gateway mode only, within bounds; SW and SH are
//               kept by the gateway in its memory: same value skipped, one
//               per minute
//   scenes      boiler fault / cleared, service request, thermostat
//               disconnected, gateway lost / back -> scene events; override,
//               outside temperature, hot water, max flow from a scene
//   widgets     boiler, history
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { buildDevices, DEVICE_TYPES, idsOf } from './devices.js';
import { t, text, truncate, truncateAll } from './i18n.js';
import { createClient } from './otgw/client.js';
import {
  DHW_TARGET,
  FEATURES,
  KNOWN_IDS,
  MAX_FLOW_TARGET,
  OUTSIDE_RANGE,
  ROOM_TARGET,
  classify,
  featureByKey,
  featuresFor,
  toState,
  valuesOf,
} from './otgw/opentherm.js';
import { OtgwError, parseAbout, parseMode, temperatureValue } from './otgw/protocol.js';
import { HOT_WATER_MODES, SCENE_ACTIONS, SCENE_TRIGGERS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { buildBoilerWidget, buildHistoryWidget, WIDGET_ACTIONS, WIDGETS } from './widgets.js';

export const ACTIONS = { TEST: 'test_connection' };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DEFAULT_TIMINGS = {
  sampleMs: 15 * SECOND, // numbers to Gladys at most this often
  discoveryDelayMs: 5 * SECOND, // a few ids arrive together
  faultDelayMs: 10 * SECOND, // the thermostat reads id 5 after it sees the fault bit
  offlineAfterMs: 3 * MINUTE,
  checkMs: 30 * SECOND,
  spacingMs: MINUTE, // SW / SH: stored in the gateway memory
  widgetSpacingMs: 11 * SECOND,
};
const LANGUAGES = ['en', 'fr', 'de', 'es'];
const SEEN_FILE = 'seen.json';
const MAX_MESSAGE = 1800;
const FAULT_NAMES = [
  'low_water_pressure',
  'gas_flame_fault',
  'air_pressure_fault',
  'water_over_temperature',
];

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {Function} [deps.clientFactory] - `(options) => client` (tests).
 * @param {object} [deps.timings] - Overrides of DEFAULT_TIMINGS (tests).
 * @param {object} [deps.clientTimings] - Passed to the client (tests).
 * @returns {object} `{ start, stop, … }`.
 */
export function createApp(
  gladys,
  {
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    clientFactory = createClient,
    timings: timingOverrides = {},
    clientTimings = {},
  } = {},
) {
  const timings = { ...DEFAULT_TIMINGS, ...timingOverrides };
  let config = normalizeConfig(gladys.config ?? {});
  let client = null;
  let stopped = false;
  let statusKey = '';

  let reachable = null; // null: never tried
  let failingSince = null;
  let lastError = null;
  let offlineFired = false;
  let firmware = null;
  let mode = null; // 'gateway' | 'monitor'
  let lastLineAt = null;
  let thermostatConnected = true;

  let seen = new Set(); // data ids seen with a value
  let publishedSeen = '';
  let discoveryTimer = null;
  let sampleTimer = null;
  let checkTimer = null;
  let faultTimer = null;

  const raw = new Map(); // value key -> last raw value (numbers, faults object)
  const created = new Set(); // device external ids
  const dirty = new Set(); // numeric feature keys waiting for the sample timer
  const transports = new Map();
  const widgetRefresh = new Map();
  const lastWrite = new Map(); // command code -> { at, value }

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });

  // The detailed log is a setting (users cannot set LOG_LEVEL on a container
  // the Gladys supervisor creates): written at the info level when it is on.
  const trace = (line) => {
    if (config.debugLogs) {
      logger.info(`otgw [detail]: ${line}`);
    }
  };

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`otgw: ${what} failed: ${error?.message ?? error}`));

  const address = () => `${config.host}:${config.port}`;
  const featureId = (feature) => idsOf(gladys, feature.device).feature(feature.key);
  const deviceId = (device) => idsOf(gladys, device).device;
  const exists = (feature) => feature.ids.some((id) => seen.has(id));

  // --- Widgets, transports, status -----------------------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + timings.widgetSpacingMs - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  // One channel: the catalog badge says it; the device badge tells local from unreachable.
  const publishTransports = () => {
    if (reachable === null) {
      return;
    }
    const transport = reachable ? 'local' : 'unreachable';
    const list = [...created]
      .filter((id) => transports.get(id) !== transport)
      .map((id) => {
        transports.set(id, transport);
        return { external_id: id, transport };
      });
    if (list.length > 0) {
      safely(() => gladys.publishTransports(list), 'transport badges');
    }
  };

  function publishStatus() {
    let key;
    let connected;
    let message;
    if (!config.host) {
      [key, connected, message] = ['nohost', false, t('statusNoHost')];
    } else if (reachable === false) {
      [key, connected, message] = [
        `off:${lastError}`,
        false,
        t('statusUnreachable', { address: address(), error: truncate(lastError, 120) }),
      ];
    } else if (reachable === null) {
      [key, connected, message] = ['wait', true, t('statusConnecting')];
    } else if (seen.size === 0) {
      [key, connected, message] = ['quiet', true, t('statusNoTraffic')];
    } else {
      key = `ok:${mode}:${firmware}`;
      connected = true;
      message = t(mode === 'monitor' ? 'statusMonitor' : 'statusConnected', {
        version: firmware ?? '?',
      });
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  }

  // --- Reachability --------------------------------------------------------------------------------

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  const markReachable = () => {
    failingSince = null;
    lastError = null;
    if (reachable !== true) {
      logger.info(`otgw: ${reachable === false ? 'reached again' : 'connected'} at ${address()}`);
      reachable = true;
      publishTransports();
      refreshWidgets();
    }
    if (offlineFired) {
      offlineFired = false;
      fire(SCENE_TRIGGERS.GATEWAY_ONLINE, { address: address() });
    }
    publishStatus();
  };

  const markUnreachable = (error) => {
    lastError = truncate(error?.message ?? String(error), 160);
    failingSince = failingSince ?? now();
    if (reachable !== false) {
      logger.warn(`otgw: lost ${address()}: ${lastError}`);
      reachable = false;
      publishTransports();
      refreshWidgets();
    }
    publishStatus();
  };

  const checkOffline = () => {
    if (
      reachable === false &&
      !offlineFired &&
      created.size > 0 &&
      failingSince !== null &&
      now() - failingSince >= timings.offlineAfterMs
    ) {
      offlineFired = true;
      fire(SCENE_TRIGGERS.GATEWAY_OFFLINE, { address: address() });
    }
  };

  // --- Discovery -----------------------------------------------------------------------------------

  const seenKey = () => [...seen].sort((a, b) => a - b).join(',');

  function publishDiscovered() {
    if (!config.host || seen.size === 0) {
      return Promise.resolve();
    }
    publishedSeen = seenKey();
    return safely(
      () =>
        gladys.publishDiscoveredDevices(
          buildDevices(gladys, {
            seen,
            firmware,
            host: config.host,
            port: config.port,
            language: config.language,
          }),
        ),
      'discovery',
    );
  }

  const scheduleDiscovery = () => {
    if (discoveryTimer || stopped) {
      return;
    }
    discoveryTimer = setTimeout(() => {
      discoveryTimer = null;
      if (seenKey() !== publishedSeen) {
        const features = featuresFor(seen).length;
        logger.info(`otgw: data ids ${seenKey()} -> ${features} features`);
        safely(() => storage.write(SEEN_FILE, { ids: [...seen] }), 'saving data ids');
        publishDiscovered();
        refreshWidgets();
        publishStatus();
      }
    }, timings.discoveryDelayMs);
    discoveryTimer.unref?.();
  };

  const markSeen = (id) => {
    if (KNOWN_IDS.includes(id) && !seen.has(id)) {
      seen.add(id);
      scheduleDiscovery();
    }
  };

  // --- Values --------------------------------------------------------------------------------------

  const isCreatedFeature = (feature) => created.has(deviceId(feature.device));

  const faultText = (language) => {
    if (raw.get('fault') !== 1) {
      return text('faultNone', language);
    }
    const faults = raw.get('faults');
    if (!faults) {
      return text('faultUnknown', language);
    }
    const parts = FAULT_NAMES.filter((name) => faults.flags[name]).map((name) =>
      text(`fault_${name}`, language),
    );
    return truncate([text('faultCode', language, { code: faults.oem }), ...parts].join(' · '), 200);
  };

  /** Push one feature now (binary, text) or at the next sample (numbers). */
  const pushFeature = (feature, { immediate = false } = {}) => {
    if (!exists(feature)) {
      return; // a feature the devices do not have: Gladys would refuse the batch
    }
    const id = featureId(feature);
    if (feature.kind === 'text') {
      if (raw.has('fault') || raw.has('faults')) {
        states.push(id, { text: faultText(config.language) });
      }
      return;
    }
    const value = toState(feature, raw.get(feature.key));
    if (value === null) {
      return;
    }
    if (immediate || feature.shape.max === 1) {
      dirty.delete(feature.key);
      states.push(id, value);
    } else {
      dirty.add(feature.key);
    }
  };

  const flushSamples = () => {
    for (const key of dirty) {
      const feature = featureByKey(key);
      const value = toState(feature, raw.get(key));
      if (value !== null) {
        states.push(featureId(feature), value);
      }
    }
    if (dirty.size > 0) {
      refreshWidget(WIDGETS.BOILER);
    }
    dirty.clear();
  };

  const pushAllKnown = () => {
    for (const feature of FEATURES) {
      pushFeature(feature, { immediate: true });
    }
  };

  const faultData = () => {
    const faults = raw.get('faults');
    const data = { oem_fault_code: faults ? faults.oem : null, faults: faultText('en') };
    for (const name of FAULT_NAMES) {
      data[name] = faults ? faults.flags[name] : null;
    }
    return data;
  };

  const boilerCreated = () => created.has(deviceId(DEVICE_TYPES.BOILER));

  const onFaultBit = (previous, current) => {
    if (previous === undefined || previous === current || !boilerCreated()) {
      return; // the first value is not news
    }
    clearTimeout(faultTimer);
    faultTimer = null;
    if (current === 1) {
      logger.info('otgw: the boiler reports a fault');
      faultTimer = setTimeout(() => {
        faultTimer = null;
        if (raw.get('fault') === 1) {
          fire(SCENE_TRIGGERS.BOILER_FAULT, faultData());
        }
      }, timings.faultDelayMs);
      faultTimer.unref?.();
    } else {
      logger.info('otgw: the boiler fault is cleared');
      fire(SCENE_TRIGGERS.BOILER_FAULT_CLEARED, {
        oem_fault_code: raw.get('faults')?.oem ?? null,
      });
    }
    refreshWidgets();
  };

  const onFaults = (previous, current) => {
    if (
      previous &&
      !previous.flags.service_request &&
      current.flags.service_request &&
      boilerCreated()
    ) {
      fire(SCENE_TRIGGERS.SERVICE_REQUESTED, { oem_fault_code: current.oem });
    }
  };

  const applyMessage = (message) => {
    const verdict = classify(message);
    if (verdict !== 'value') {
      return;
    }
    const entries = valuesOf(message);
    if (entries.length === 0) {
      return;
    }
    markSeen(message.id);
    for (const [key, value] of entries) {
      const previous = raw.get(key);
      raw.set(key, value);
      if (key === 'fault') {
        onFaultBit(previous, value);
      }
      if (key === 'faults') {
        onFaults(previous, value);
      }
      if (key === 'fault' || key === 'faults') {
        if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(value)) {
          pushFeature(featureByKey('fault_details'));
        }
        if (key === 'faults') {
          continue;
        }
      }
      const feature = featureByKey(key);
      if (feature) {
        const changed = previous !== value;
        pushFeature(feature);
        if (changed && feature.shape.max === 1) {
          refreshWidget(WIDGETS.BOILER);
        }
      }
    }
  };

  const onLine = (parsed) => {
    lastLineAt = now();
    if (reachable !== true) {
      markReachable();
    }
    if (parsed.kind === 'message') {
      applyMessage(parsed);
      return;
    }
    if (parsed.kind === 'event') {
      if (parsed.event === 'thermostat_disconnected' && thermostatConnected) {
        thermostatConnected = false;
        logger.warn('otgw: the gateway sees no thermostat');
        fire(SCENE_TRIGGERS.THERMOSTAT_DISCONNECTED, { address: address() });
        refreshWidgets();
      } else if (parsed.event === 'thermostat_connected' && !thermostatConnected) {
        thermostatConnected = true;
        logger.info('otgw: the thermostat is back');
        refreshWidgets();
      } else {
        trace(parsed.text);
      }
    }
  };

  // --- Connection ----------------------------------------------------------------------------------

  const handshake = async () => {
    const about = await client.command('PR', 'A');
    const version = parseAbout(about);
    if (version && version !== firmware) {
      firmware = version;
      logger.info(`otgw: OpenTherm Gateway ${firmware}`);
    }
    const reported = parseMode(await client.command('PR', 'M'));
    if (reported && reported !== mode) {
      mode = reported;
      if (mode === 'monitor') {
        logger.warn('otgw: the gateway is in monitor mode: it reads, it cannot change anything');
      }
    }
    // One line per OpenTherm message (PS=1 would print a summary instead).
    await client.command('PS', '0');
    markReachable();
    if (seenKey() !== publishedSeen) {
      publishDiscovered();
    }
  };

  const onClientState = (up, error) => {
    if (up) {
      markReachable();
      safely(handshake, 'gateway identification');
    } else {
      markUnreachable(error ?? new Error('disconnected'));
    }
  };

  const ensureClient = () => {
    if (!client && config.host && !stopped) {
      client = clientFactory({
        host: config.host,
        port: config.port,
        onLine,
        onState: onClientState,
        trace,
        timings: clientTimings,
      });
    }
    return client;
  };

  const resetClient = () => {
    client?.close();
    client = null;
  };

  // --- Commands ------------------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  const refusal = (error) => {
    if (error?.userFacing) {
      return error;
    }
    if (error instanceof OtgwError && error.code) {
      return userError('errorRefused', { code: error.code });
    }
    return userError('errorUnreachable', {
      address: address(),
      error: truncate(error?.message ?? error, 160),
    });
  };

  const refuse = (key, vars) => Object.assign(userError(key, vars), { userFacing: true });

  const inRange = (value, { min, max }) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

  /**
   * @description Send a command, after the checks every command shares.
   * @param {string} code - Two letters.
   * @param {string} value - Value.
   * @param {object} [options] - `{ spaced }`: kept in the gateway memory (once a minute, never twice).
   * @returns {Promise<string>} What the gateway understood.
   */
  const send = async (code, value, { spaced = false } = {}) => {
    if (!config.host) {
      throw refuse('errorNoHost');
    }
    if (!ensureClient()?.connected()) {
      throw refuse('errorUnreachable', { address: address(), error: lastError ?? '?' });
    }
    if (mode === 'monitor') {
      throw refuse('errorMonitor');
    }
    if (spaced) {
      const last = lastWrite.get(code);
      if (last?.value === value) {
        return last.answer;
      }
      if (last && now() - last.at < timings.spacingMs) {
        throw refuse('errorTooSoon', {
          seconds: Math.ceil((last.at + timings.spacingMs - now()) / 1000),
        });
      }
    }
    try {
      const answer = await client.command(code, value);
      logger.info(`otgw: ${code}=${value} accepted (${answer})`);
      if (spaced) {
        lastWrite.set(code, { at: now(), value, answer });
      }
      return answer;
    } catch (error) {
      throw refusal(error);
    }
  };

  const setOverride = async (temperature, overrideMode = config.overrideMode) => {
    if (!inRange(temperature, ROOM_TARGET)) {
      throw refuse('errorRange', { min: ROOM_TARGET.min, max: ROOM_TARGET.max });
    }
    const value = temperatureValue(Math.round(temperature / ROOM_TARGET.step) * ROOM_TARGET.step);
    const answer = await send(overrideMode === 'constant' ? 'TC' : 'TT', value);
    // The thermostat takes it within a few seconds (data id 16 follows); show it now.
    raw.set('room_setpoint', Number(answer) || Number(value));
    pushFeature(featureByKey('room_setpoint'), { immediate: true });
    refreshWidget(WIDGETS.BOILER);
    return answer;
  };

  const handleSetValue = async (feature, value) => {
    const number = Number(value);
    if (feature.key === 'room_setpoint') {
      await setOverride(number);
      return;
    }
    if (feature.key === 'dhw_setpoint') {
      if (!inRange(number, DHW_TARGET)) {
        throw refuse('errorRange', { min: DHW_TARGET.min, max: DHW_TARGET.max });
      }
      const answer = await send('SW', temperatureValue(number), { spaced: true });
      raw.set('dhw_setpoint', Number(answer) || number);
      pushFeature(feature, { immediate: true });
      return;
    }
    if (feature.key === 'dhw_enable') {
      const on = number === 1;
      await send('HW', on ? '1' : '0');
      raw.set('dhw_enable', on ? 1 : 0);
      pushFeature(feature, { immediate: true });
      return;
    }
    throw refuse('errorReadOnly');
  };

  gladys.onSetValue(async (device, deviceFeature, value) => {
    const external = String(deviceFeature?.external_id ?? '');
    const feature = FEATURES.find((item) => featureId(item) === external);
    if (!feature) {
      throw userError('errorUnknownDevice');
    }
    try {
      await handleSetValue(feature, value);
      refreshWidgets();
    } catch (error) {
      // Gladys shows the value asked for: put the real one back.
      states.forget(external);
      pushFeature(feature, { immediate: true });
      throw refusal(error);
    }
  });

  // --- Device events -------------------------------------------------------------------------------

  const trackCreated = (device) => {
    const external = String(device?.external_id ?? '');
    if (!Object.values(DEVICE_TYPES).some((type) => external === deviceId(type))) {
      return false;
    }
    created.add(external);
    return true;
  };

  gladys.onDeviceCreated(async (device) => {
    if (trackCreated(device)) {
      // States published before the creation were thrown away by Gladys.
      states.republish(device.external_id);
      pushAllKnown();
      transports.delete(device.external_id);
      publishTransports();
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    if (trackCreated(device)) {
      states.republish(device.external_id);
      pushAllKnown();
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      states.forget(device.external_id);
    }
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    ensureClient();
    await publishDiscovered();
  });

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    config = normalizeConfig(rawConfig ?? {});
    if (previous.host !== config.host || previous.port !== config.port) {
      resetClient();
      reachable = null;
      offlineFired = false;
      failingSince = null;
      firmware = null;
      mode = null;
      ensureClient();
    }
    if (previous.debugLogs !== config.debugLogs) {
      logger.info(`otgw: detailed log ${config.debugLogs ? 'on' : 'off'}`);
    }
    if (previous.language !== config.language) {
      await publishDiscovered();
      [...created].forEach((id) => states.forget(id));
      pushAllKnown();
    }
    publishStatus();
    refreshWidgets();
  });

  // --- Configuration button ------------------------------------------------------------------------

  const waitFor = (condition, ms) =>
    new Promise((resolve) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (condition() || Date.now() >= end) {
          resolve(condition());
        } else {
          setTimeout(tick, 100).unref?.();
        }
      };
      tick();
    });

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!config.host) {
      return t('statusNoHost');
    }
    ensureClient();
    if (!(await waitFor(() => client?.connected(), 12 * SECOND))) {
      return t('testUnreachable', { address: address(), error: truncate(lastError ?? '?', 160) });
    }
    try {
      await handshake();
    } catch (error) {
      return t('testNotOtgw', { address: address(), error: truncate(error.message, 160) });
    }
    // A thermostat asks the boiler something every second.
    await waitFor(() => lastLineAt !== null && now() - lastLineAt < 5 * SECOND, 5 * SECOND);
    const message = {};
    for (const language of LANGUAGES) {
      const features = featuresFor(seen)
        .map((feature) => text(`feature_${feature.key}`, language))
        .join(', ');
      message[language] = [
        text('testOk', language, { version: firmware ?? '?' }),
        text(mode === 'monitor' ? 'testMonitor' : 'testGateway', language),
        seen.size > 0
          ? text('testFeatures', language, { list: features })
          : text('testNoTraffic', language),
      ].join(' ');
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions -------------------------------------------------------------------------------

  const result = (answer) => ({ result: truncate(String(answer ?? ''), 1000) });

  gladys.onSceneAction(SCENE_ACTIONS.SET_ROOM_OVERRIDE, async (fields = {}) => {
    const overrideMode = fields.mode === 'constant' ? 'constant' : 'temporary';
    return result(await setOverride(Number(fields.temperature), overrideMode));
  });

  gladys.onSceneAction(SCENE_ACTIONS.CANCEL_ROOM_OVERRIDE, async () =>
    // TT=0 ends a temporary or a constant override.
    result(await send('TT', '0')),
  );

  gladys.onSceneAction(SCENE_ACTIONS.SET_OUTSIDE_TEMPERATURE, async (fields = {}) => {
    const temperature = Number(fields.temperature);
    if (!inRange(temperature, OUTSIDE_RANGE)) {
      throw refuse('errorRange', { min: OUTSIDE_RANGE.min, max: OUTSIDE_RANGE.max });
    }
    return result(await send('OT', temperatureValue(Math.round(temperature * 10) / 10)));
  });

  gladys.onSceneAction(SCENE_ACTIONS.CLEAR_OUTSIDE_TEMPERATURE, async () =>
    result(await send('OT', '-')),
  );

  gladys.onSceneAction(SCENE_ACTIONS.SET_HOT_WATER, async (fields = {}) => {
    const value = HOT_WATER_MODES[fields.mode];
    if (!value) {
      throw refuse('errorHotWaterMode');
    }
    const answer = await send('HW', value);
    if (value !== 'T') {
      raw.set('dhw_enable', Number(value));
      pushFeature(featureByKey('dhw_enable'), { immediate: true });
    }
    return result(answer);
  });

  gladys.onSceneAction(SCENE_ACTIONS.SET_MAX_FLOW_TEMPERATURE, async (fields = {}) => {
    const temperature = Number(fields.temperature);
    if (temperature !== 0 && !inRange(temperature, MAX_FLOW_TARGET)) {
      throw refuse('errorRangeOrZero', { min: MAX_FLOW_TARGET.min, max: MAX_FLOW_TARGET.max });
    }
    return result(await send('SH', temperatureValue(Math.round(temperature)), { spaced: true }));
  });

  // --- Widgets -------------------------------------------------------------------------------------

  const faultDetailsAll = () =>
    Object.fromEntries(LANGUAGES.map((language) => [language, faultText(language)]));

  const boilerView = () => {
    if (!config.host) {
      return null;
    }
    const entries = {};
    for (const feature of FEATURES) {
      if (!exists(feature) || feature.kind === 'text') {
        continue;
      }
      const value = toState(feature, raw.get(feature.key));
      entries[feature.key] = {
        value,
        featureId: isCreatedFeature(feature) && feature.shape.max !== 1 ? featureId(feature) : null,
      };
    }
    const override = raw.get('override_setpoint');
    return {
      reachable: Boolean(reachable),
      mode,
      firmware,
      thermostatConnected,
      anyValue: seen.size > 0,
      values: entries,
      fault: raw.get('fault') === 1 ? truncateAll(faultDetailsAll(), 60) : null,
      override: typeof override === 'number' && override > 0 ? override : null,
    };
  };

  gladys.onWidgetGet(WIDGETS.BOILER, async () => buildBoilerWidget(boilerView()));
  gladys.onWidgetGet(WIDGETS.HISTORY, async ({ settings } = {}) =>
    buildHistoryWidget(boilerView(), settings?.period),
  );
  gladys.onWidgetAction(WIDGETS.BOILER, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.CANCEL_OVERRIDE) {
      throw userError('errorUnknownAction');
    }
    await send('TT', '0');
    raw.set('override_setpoint', 0);
    raw.set('override_active', 0);
    pushFeature(featureByKey('override_active'), { immediate: true });
    refreshWidget(WIDGETS.BOILER);
    return t('toastOverrideCancelled');
  });

  // --- Lifecycle -----------------------------------------------------------------------------------

  return {
    /** Restore the known data ids, connect, publish. */
    async start() {
      stopped = false;
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      const saved = await storage.read(SEEN_FILE);
      if (Array.isArray(saved?.ids)) {
        seen = new Set(saved.ids.filter((id) => KNOWN_IDS.includes(id)));
      }
      publishStatus();
      await publishDiscovered();
      sampleTimer = setInterval(flushSamples, timings.sampleMs);
      sampleTimer.unref?.();
      checkTimer = setInterval(checkOffline, timings.checkMs);
      checkTimer.unref?.();
      ensureClient();
    },

    async stop() {
      stopped = true;
      clearInterval(sampleTimer);
      clearInterval(checkTimer);
      clearTimeout(discoveryTimer);
      clearTimeout(faultTimer);
      discoveryTimer = null;
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      states.stop();
      resetClient();
    },

    flushSamples,
    flushStates: () => states.flush(),
    checkOffline,
    seen: () => seen,
    raw,
  };
}
