// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   boiler    the boiler at a glance: flow, return, room and hot water
//             temperatures, modulation, pressure (tiles that follow the
//             device states live once the devices are created), then the
//             burner, heating, hot water, fault and override states; a
//             button gives the thermostat its program back when Gladys
//             imposed a setpoint
//   history   the curves of these temperatures (a day, three days, a week)
//
// Pure: the build functions turn a view into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { number, t } from './i18n.js';

export const WIDGETS = { BOILER: 'boiler', HISTORY: 'history' };
export const WIDGET_ACTIONS = { CANCEL_OVERRIDE: 'cancel_override' };
export const HISTORY_PERIODS = ['last-day', 'last-three-days', 'last-week'];
const TTL = { boiler: 60, history: 300 };

// The tiles, in order of preference (6 at most): feature key -> label key, color, digits.
export const TILES = [
  ['flow_temperature', 'widgetFlow', 'primary', 1],
  ['return_temperature', 'widgetReturn', undefined, 1],
  ['room_temperature', 'widgetRoom', undefined, 1],
  ['dhw_temperature', 'widgetHotWater', 'info', 1],
  ['modulation', 'widgetModulation', 'warning', 0],
  ['pressure', 'widgetPressure', undefined, 2],
  ['outside_temperature', 'widgetOutdoor', undefined, 1],
  ['control_setpoint', 'widgetFlowTarget', undefined, 1],
];
const UNITS = { modulation: '%', pressure: 'bar' };
export const HISTORY_KEYS = [
  'flow_temperature',
  'return_temperature',
  'room_temperature',
  'dhw_temperature',
];

/**
 * @typedef {object} BoilerView
 * @property {boolean} reachable - The gateway answers.
 * @property {'gateway'|'monitor'|null} mode - Gateway mode.
 * @property {boolean} thermostatConnected - The gateway sees a thermostat.
 * @property {boolean} anyValue - At least one OpenTherm value seen.
 * @property {Record<string, {value: number|null, featureId: string|null}>} values - By feature key.
 * @property {object|null} fault - Multi-language fault text, null without fault.
 * @property {number|null} override - Room setpoint imposed by the gateway.
 */

const empty = (key, message) => ({
  version: 1,
  ttl_seconds: TTL[key],
  components: [{ type: 'text', text: t(message), variant: 'caption' }],
});

const tile = ([key, label, color, digits], entry) => {
  if (!entry) {
    return null;
  }
  if (entry.featureId) {
    return {
      type: 'value',
      label: t(label),
      device_feature: entry.featureId,
      ...(color ? { color } : {}),
    };
  }
  if (typeof entry.value !== 'number') {
    return null;
  }
  return {
    type: 'value',
    label: t(label),
    value: Math.round(entry.value * 10 ** digits) / 10 ** digits,
    unit: UNITS[key] ?? '°C',
    ...(color ? { color } : {}),
  };
};

const onOff = (label, value, onColor) =>
  value === 0 || value === 1
    ? {
        label: t(label),
        value: t(value ? 'widgetOn' : 'widgetOff'),
        color: value ? onColor : 'neutral',
      }
    : null;

/**
 * @description The `boiler` widget.
 * @param {BoilerView|null} view - The view.
 * @returns {object} The widget content.
 */
export function buildBoilerWidget(view) {
  if (!view) {
    return empty(WIDGETS.BOILER, 'widgetNoHost');
  }
  if (!view.anyValue) {
    return empty(WIDGETS.BOILER, view.reachable ? 'widgetWaiting' : 'widgetUnreachable');
  }
  const components = TILES.map((spec) => tile(spec, view.values[spec[0]]))
    .filter(Boolean)
    .slice(0, 6);
  const value = (key) => view.values[key]?.value;
  const items = [];
  if (!view.reachable) {
    items.push({ label: t('widgetGateway'), value: t('widgetOffline'), color: 'danger' });
  }
  if (view.fault) {
    items.push({ label: t('widgetFault'), value: view.fault, color: 'danger' });
  }
  items.push(
    ...[
      onOff('widgetBurner', value('flame'), 'warning'),
      onOff('widgetHeating', value('ch_active'), 'primary'),
      onOff('widgetHotWaterActive', value('dhw_active'), 'info'),
    ].filter(Boolean),
  );
  if (!view.fault && value('fault') === 0) {
    items.push({ label: t('widgetFault'), value: t('widgetNone'), color: 'success' });
  }
  if (typeof view.override === 'number') {
    items.push({
      label: t('widgetOverride'),
      value: number(view.override, 1, '°C'),
      color: 'info',
    });
  }
  if (!view.thermostatConnected) {
    items.push({ label: t('widgetThermostat'), value: t('widgetNoThermostat'), color: 'danger' });
  }
  if (view.mode === 'monitor') {
    items.push({ label: t('widgetGateway'), value: t('widgetMonitorMode'), color: 'warning' });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items: items.slice(0, 6) });
  }
  if (components.length === 0) {
    components.push({ type: 'text', text: t('widgetWaiting'), variant: 'caption' });
  }
  if (typeof view.override === 'number' && view.reachable && view.mode !== 'monitor') {
    components.push({
      type: 'button',
      label: t('widgetCancelOverride'),
      icon: 'rotate-ccw',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.CANCEL_OVERRIDE },
    });
  }
  return { version: 1, ttl_seconds: TTL.boiler, components };
}

/**
 * @description The `history` widget.
 * @param {BoilerView|null} view - The view.
 * @param {string} [period] - One of HISTORY_PERIODS.
 * @returns {object} The widget content.
 */
export function buildHistoryWidget(view, period = HISTORY_PERIODS[0]) {
  if (!view) {
    return empty(WIDGETS.HISTORY, 'widgetNoHost');
  }
  const features = HISTORY_KEYS.map((key) => view.values[key]?.featureId).filter(Boolean);
  if (features.length === 0) {
    return empty(WIDGETS.HISTORY, view.anyValue ? 'widgetAddDevice' : 'widgetWaiting');
  }
  const components = [
    {
      type: 'chart',
      title: t('widgetTemperatures'),
      chart_type: 'line',
      device_features: features,
      interval: HISTORY_PERIODS.includes(period) ? period : HISTORY_PERIODS[0],
    },
  ];
  if (!view.reachable) {
    components.push({
      type: 'status',
      items: [{ label: t('widgetGateway'), value: t('widgetOffline'), color: 'danger' }],
    });
  }
  return { version: 1, ttl_seconds: TTL.history, components };
}
