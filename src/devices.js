// -----------------------------------------------------------------------------
// The Gladys devices of one OpenTherm Gateway:
//
//   ext:{selector}:boiler:otgw[:{feature}]       the boiler (flame, temperatures,
//                                                hot water, pressure, counters…)
//   ext:{selector}:thermostat:otgw[:{feature}]   the room thermostat (room
//                                                temperature and setpoint)
//
// A gateway sits between one thermostat and one boiler, and nothing in the
// protocol identifies them (no serial number): the ids are fixed, one gateway
// per integration. Only the features of the data ids seen exist
// (src/otgw/opentherm.js); the discovery is published again when a new one
// shows up.
// -----------------------------------------------------------------------------

import { DEVICES, featuresFor } from './otgw/opentherm.js';
import { text } from './i18n.js';

export const GATEWAY_ID = 'otgw';
export const DEVICE_TYPES = DEVICES;

const params = (entries) =>
  Object.entries(entries)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([name, value]) => ({ name, value: String(value) }));

/**
 * @description The ids of a device.
 * @param {object} gladys - SDK client.
 * @param {string} device - DEVICES value.
 * @returns {{ device: string, feature: Function }} External ids.
 */
export const idsOf = (gladys, device) => gladys.externalIds(device, GATEWAY_ID);

/**
 * @description The Gladys devices.
 * @param {object} gladys - SDK client (ids).
 * @param {object} input - `{ seen, firmware, host, port, language }`.
 * @returns {object[]} Devices for `publishDiscoveredDevices`.
 */
export function buildDevices(gladys, { seen, firmware, host, port, language }) {
  const features = featuresFor(seen);
  const devices = [];
  for (const device of [DEVICES.BOILER, DEVICES.THERMOSTAT]) {
    const own = features.filter((feature) => feature.device === device);
    if (own.length === 0) {
      continue;
    }
    const ids = idsOf(gladys, device);
    devices.push({
      name: text(`device_${device}`, language),
      external_id: ids.device,
      model: firmware ? `OpenTherm Gateway ${firmware}` : 'OpenTherm Gateway',
      should_poll: false,
      params: params({ OTGW_HOST: host, OTGW_PORT: port, OTGW_FIRMWARE: firmware }),
      features: own.map((feature) => ({
        name: text(`feature_${feature.key}`, language),
        external_id: ids.feature(feature.key),
        ...feature.shape,
      })),
    });
  }
  return devices;
}
