// -----------------------------------------------------------------------------
// OpenTherm messages -> Gladys features (pure).
//
// The thermostat keeps asking the boiler for values (status every second, the
// others in turn): the gateway prints each exchange, the integration reads
// the values in it. Only the data ids a boiler or a thermostat actually
// answered become features, so a boiler without a pressure sensor gets no
// pressure feature. The data ids are those of the OpenTherm 2.2
// specification:
//
//   0    status: master (CH / DHW enable…) and slave (fault, CH, DHW, flame…)
//   1    control setpoint (flow temperature the thermostat asks for)
//   5    application-specific fault flags + OEM fault code
//   9    remote override room setpoint (what the gateway imposes, 0 = none)
//   16   room setpoint · 24 room temperature (thermostat)
//   17   relative modulation · 18 CH water pressure
//   25   flow · 26 hot water · 27 outside · 28 return · 33 exhaust temperatures
//   56   hot water setpoint · 57 max CH water setpoint
//   116…123  burner / pump starts and hours
//
// Which lines carry a value: a boiler answer (B, or A when the gateway
// answered the thermostat itself) with a Read-Ack or Write-Ack, and a
// thermostat write (T, or R when the gateway changed it) with Write-Data
// (room temperature and setpoint are written by the thermostat; a boiler that
// does not know them answers Unknown-DataId, the value is still the
// thermostat's).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { f88, flag, MESSAGE_TYPES, s16, u16 } from './protocol.js';

export const DEVICES = { BOILER: 'boiler', THERMOSTAT: 'thermostat' };

// Bounds of what Gladys may ask (never wider; the gateway would accept more).
export const ROOM_TARGET = { min: 5, max: 30, step: 0.5 };
export const DHW_TARGET = { min: 35, max: 70, step: 0.5 };
export const MAX_FLOW_TARGET = { min: 20, max: 90 };
export const OUTSIDE_RANGE = { min: -40, max: 64 };

const sensor = (category, type, unit, min, max) => ({
  category,
  type,
  ...(unit ? { unit } : {}),
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

const temperature = () =>
  sensor(CAT.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.CELSIUS, -40, 150);
const binary = () => sensor(CAT.SWITCH, TYPES.SWITCH.BINARY, undefined, 0, 1);
const counter = () => sensor(CAT.COUNTER_SENSOR, TYPES.SENSOR.INTEGER, undefined, 0, 65535);
const hours = () => sensor(CAT.DURATION, TYPES.DURATION.INTEGER, UNITS.HOURS, 0, 65535);

/**
 * The features, in the order Gladys shows them. `ids`: the data ids that
 * make the feature exist (any of them seen with a value). `digits`: the
 * rounding of the published value (an OpenTherm temperature has 1/256 °C
 * steps; the flow temperature would otherwise change every second).
 */
export const FEATURES = [
  // --- Boiler ------------------------------------------------------------------------------
  { key: 'flame', device: DEVICES.BOILER, ids: [0], shape: binary() },
  { key: 'ch_active', device: DEVICES.BOILER, ids: [0], shape: binary() },
  {
    key: 'dhw_active',
    device: DEVICES.BOILER,
    ids: [0],
    shape: sensor(CAT.WATER_HEATER, TYPES.WATER_HEATER.HEATING, undefined, 0, 1),
  },
  { key: 'fault', device: DEVICES.BOILER, ids: [0], shape: binary() },
  {
    key: 'fault_details',
    device: DEVICES.BOILER,
    ids: [5],
    kind: 'text',
    shape: {
      category: CAT.TEXT,
      type: TYPES.TEXT.TEXT,
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
  },
  {
    key: 'modulation',
    device: DEVICES.BOILER,
    ids: [17],
    digits: 0,
    shape: sensor(CAT.LEVEL_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.PERCENT, 0, 100),
  },
  { key: 'flow_temperature', device: DEVICES.BOILER, ids: [25], digits: 1, shape: temperature() },
  {
    key: 'return_temperature',
    device: DEVICES.BOILER,
    ids: [28],
    digits: 1,
    shape: temperature(),
  },
  { key: 'control_setpoint', device: DEVICES.BOILER, ids: [1], digits: 1, shape: temperature() },
  {
    key: 'max_flow_setpoint',
    device: DEVICES.BOILER,
    ids: [57],
    digits: 1,
    shape: temperature(),
  },
  {
    key: 'pressure',
    device: DEVICES.BOILER,
    ids: [18],
    digits: 2,
    shape: sensor(CAT.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.BAR, 0, 10),
  },
  { key: 'dhw_temperature', device: DEVICES.BOILER, ids: [26], digits: 1, shape: temperature() },
  {
    key: 'dhw_setpoint',
    device: DEVICES.BOILER,
    ids: [56],
    digits: 1,
    writable: 'SW',
    bounds: DHW_TARGET,
    shape: {
      category: CAT.WATER_HEATER,
      type: TYPES.WATER_HEATER.TARGET_TEMPERATURE,
      unit: UNITS.CELSIUS,
      min: DHW_TARGET.min,
      max: DHW_TARGET.max,
      step: DHW_TARGET.step,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
  },
  {
    key: 'dhw_enable',
    device: DEVICES.BOILER,
    ids: [0],
    writable: 'HW',
    shape: {
      category: CAT.WATER_HEATER,
      type: TYPES.WATER_HEATER.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
  },
  {
    key: 'outside_temperature',
    device: DEVICES.BOILER,
    ids: [27],
    digits: 1,
    shape: temperature(),
  },
  {
    key: 'exhaust_temperature',
    device: DEVICES.BOILER,
    ids: [33],
    digits: 0,
    shape: temperature(),
  },
  { key: 'burner_starts', device: DEVICES.BOILER, ids: [116], shape: counter() },
  { key: 'ch_pump_starts', device: DEVICES.BOILER, ids: [117], shape: counter() },
  { key: 'dhw_pump_starts', device: DEVICES.BOILER, ids: [118], shape: counter() },
  { key: 'dhw_burner_starts', device: DEVICES.BOILER, ids: [119], shape: counter() },
  { key: 'burner_hours', device: DEVICES.BOILER, ids: [120], shape: hours() },
  { key: 'ch_pump_hours', device: DEVICES.BOILER, ids: [121], shape: hours() },
  { key: 'dhw_pump_hours', device: DEVICES.BOILER, ids: [122], shape: hours() },
  { key: 'dhw_burner_hours', device: DEVICES.BOILER, ids: [123], shape: hours() },

  // --- Thermostat --------------------------------------------------------------------------
  {
    key: 'room_temperature',
    device: DEVICES.THERMOSTAT,
    ids: [24],
    digits: 1,
    shape: temperature(),
  },
  {
    key: 'room_setpoint',
    device: DEVICES.THERMOSTAT,
    ids: [16],
    digits: 1,
    writable: 'TT',
    bounds: ROOM_TARGET,
    shape: {
      category: CAT.THERMOSTAT,
      type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
      unit: UNITS.CELSIUS,
      min: ROOM_TARGET.min,
      max: ROOM_TARGET.max,
      step: ROOM_TARGET.step,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
  },
  { key: 'override_active', device: DEVICES.THERMOSTAT, ids: [9], shape: binary() },
];

export const FEATURE_KEYS = FEATURES.map((feature) => feature.key);
export const featureByKey = (key) => FEATURES.find((feature) => feature.key === key) ?? null;

// The data ids with a value the integration uses.
export const KNOWN_IDS = [...new Set(FEATURES.flatMap((feature) => feature.ids))].sort(
  (a, b) => a - b,
);

const COUNTER_IDS = {
  116: 'burner_starts',
  117: 'ch_pump_starts',
  118: 'dhw_pump_starts',
  119: 'dhw_burner_starts',
  120: 'burner_hours',
  121: 'ch_pump_hours',
  122: 'dhw_pump_hours',
  123: 'dhw_burner_hours',
};
const TEMPERATURE_IDS = {
  1: 'control_setpoint',
  16: 'room_setpoint',
  24: 'room_temperature',
  25: 'flow_temperature',
  26: 'dhw_temperature',
  27: 'outside_temperature',
  28: 'return_temperature',
  56: 'dhw_setpoint',
  57: 'max_flow_setpoint',
};

/**
 * @description Whether a message line carries a value worth reading.
 * @param {object} message - `parseLine` result of kind `message`.
 * @returns {'value'|'unsupported'|null} `unsupported`: the boiler does not know this id.
 */
export function classify(message) {
  const { source, type } = message;
  if (source === 'B' || source === 'A') {
    if (type === MESSAGE_TYPES.READ_ACK || type === MESSAGE_TYPES.WRITE_ACK) {
      return 'value';
    }
    if (type === MESSAGE_TYPES.UNKNOWN_DATA_ID && source === 'B') {
      return 'unsupported';
    }
    return null;
  }
  if ((source === 'T' || source === 'R') && type === MESSAGE_TYPES.WRITE_DATA) {
    return 'value';
  }
  return null;
}

/**
 * @description The fault flags of data id 5 (high byte).
 * @param {number} hi - High byte.
 * @returns {object} The flags as booleans.
 */
export function faultFlags(hi) {
  return {
    service_request: flag(hi, 0) === 1,
    lockout_reset: flag(hi, 1) === 1,
    low_water_pressure: flag(hi, 2) === 1,
    gas_flame_fault: flag(hi, 3) === 1,
    air_pressure_fault: flag(hi, 4) === 1,
    water_over_temperature: flag(hi, 5) === 1,
  };
}

/**
 * @description The values carried by one message.
 * @param {object} message - `parseLine` result of kind `message`, already classified `value`.
 * @returns {Array<[string, number|object]>} `[feature key or raw key, value]`; raw keys
 *   (`master_status`, `slave_status`, `faults`, `override_setpoint`) feed several features.
 */
export function valuesOf(message) {
  const { id, hi, lo, source } = message;
  if (id === 0) {
    // The thermostat's own Write-Data never carries id 0; a Read-Ack does, both halves.
    if (source === 'T' || source === 'R') {
      return [];
    }
    return [
      ['flame', flag(lo, 3)],
      ['ch_active', flag(lo, 1)],
      ['dhw_active', flag(lo, 2)],
      ['fault', flag(lo, 0)],
      ['dhw_enable', flag(hi, 1)],
      ['ch_enable', flag(hi, 0)],
    ];
  }
  if (id === 5) {
    return [['faults', { flags: faultFlags(hi), oem: lo }]];
  }
  if (id === 9) {
    const value = f88(hi, lo);
    return [
      ['override_setpoint', value],
      ['override_active', value > 0 ? 1 : 0],
    ];
  }
  if (id === 17) {
    return [['modulation', f88(hi, lo)]];
  }
  if (id === 18) {
    return [['pressure', f88(hi, lo)]];
  }
  if (id === 33) {
    return [['exhaust_temperature', s16(hi, lo)]];
  }
  if (TEMPERATURE_IDS[id]) {
    return [[TEMPERATURE_IDS[id], f88(hi, lo)]];
  }
  if (COUNTER_IDS[id]) {
    return [[COUNTER_IDS[id], u16(hi, lo)]];
  }
  return [];
}

/**
 * @description A value fit for Gladys (rounded, within the feature bounds).
 * @param {object} feature - FEATURES entry.
 * @param {number} value - Raw value.
 * @returns {number|null} The state, null when out of the sensor range (a missing sensor).
 */
export function toState(feature, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const digits = feature.digits ?? 0;
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const { min, max } = feature.shape;
  if (max > min && (rounded < min || rounded > max)) {
    return null;
  }
  return rounded;
}

/**
 * @description The features that exist for a set of data ids seen with a value.
 * @param {Set<number>} seen - Data ids.
 * @returns {object[]} FEATURES entries.
 */
export function featuresFor(seen) {
  return FEATURES.filter((feature) => feature.ids.some((id) => seen.has(id)));
}
