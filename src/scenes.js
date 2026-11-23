// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers`, `scene_actions`).
//
// Triggers: one event per transition seen in the OpenTherm traffic, never a
// snapshot, never fired by a command or a scene action.
//
//   boiler_fault             the fault bit of the boiler status goes 0 -> 1
//                            (with the OEM fault code and the fault flags
//                            when the boiler gives them, data id 5)
//   boiler_fault_cleared     …goes back to 0
//   service_requested        the boiler asks for maintenance (data id 5)
//   thermostat_disconnected  the gateway no longer sees an OpenTherm
//                            thermostat on its terminals
//   gateway_offline          no line from the gateway for 3 minutes
//   gateway_online           it talks again (after an offline event only)
//
// Actions (the gateway answers each command, they never queue for later):
//
//   set_room_override          impose a room setpoint (TT temporary, TC constant)
//   cancel_room_override       give the thermostat its program back (TT=0)
//   set_outside_temperature    tell the thermostat the outside temperature
//                              (OT, from a Gladys sensor or a weather service)
//   clear_outside_temperature  stop doing so (OT=-)
//   set_hot_water              keep hot water on, off, or back to the thermostat (HW)
//   set_max_flow_temperature   the maximum CH water temperature (SH, kept by
//                              the gateway: spaced, see SPACED_COMMANDS)
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  BOILER_FAULT: 'boiler_fault',
  BOILER_FAULT_CLEARED: 'boiler_fault_cleared',
  SERVICE_REQUESTED: 'service_requested',
  THERMOSTAT_DISCONNECTED: 'thermostat_disconnected',
  GATEWAY_OFFLINE: 'gateway_offline',
  GATEWAY_ONLINE: 'gateway_online',
};

const FAULT_DATA = [
  'oem_fault_code',
  'faults',
  'low_water_pressure',
  'gas_flame_fault',
  'air_pressure_fault',
  'water_over_temperature',
];

// The data keys of each event, as declared in the manifest (variables).
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.BOILER_FAULT]: FAULT_DATA,
  [SCENE_TRIGGERS.BOILER_FAULT_CLEARED]: ['oem_fault_code'],
  [SCENE_TRIGGERS.SERVICE_REQUESTED]: ['oem_fault_code'],
  [SCENE_TRIGGERS.THERMOSTAT_DISCONNECTED]: ['address'],
  [SCENE_TRIGGERS.GATEWAY_OFFLINE]: ['address'],
  [SCENE_TRIGGERS.GATEWAY_ONLINE]: ['address'],
};

export const SCENE_ACTIONS = {
  SET_ROOM_OVERRIDE: 'set_room_override',
  CANCEL_ROOM_OVERRIDE: 'cancel_room_override',
  SET_OUTSIDE_TEMPERATURE: 'set_outside_temperature',
  CLEAR_OUTSIDE_TEMPERATURE: 'clear_outside_temperature',
  SET_HOT_WATER: 'set_hot_water',
  SET_MAX_FLOW_TEMPERATURE: 'set_max_flow_temperature',
};

// The outputs each action returns, as declared in the manifest.
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.SET_ROOM_OVERRIDE]: ['result'],
  [SCENE_ACTIONS.CANCEL_ROOM_OVERRIDE]: ['result'],
  [SCENE_ACTIONS.SET_OUTSIDE_TEMPERATURE]: ['result'],
  [SCENE_ACTIONS.CLEAR_OUTSIDE_TEMPERATURE]: ['result'],
  [SCENE_ACTIONS.SET_HOT_WATER]: ['result'],
  [SCENE_ACTIONS.SET_MAX_FLOW_TEMPERATURE]: ['result'],
};

export const HOT_WATER_MODES = { on: '1', off: '0', thermostat: 'T' };
