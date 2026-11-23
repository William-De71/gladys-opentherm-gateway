// -----------------------------------------------------------------------------
// Integration configuration: the `config_schema` values of the manifest,
// normalized so the rest of the code never deals with strings from a form or
// `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
// The "Legacy TCP port" of the NodoShop OTGW-firmware; ser2net users choose theirs.
export const DEFAULT_PORT = 25238;
// TT: until the next program change of the thermostat; TC: until cancelled.
export const OVERRIDE_MODES = ['temporary', 'constant'];

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULTS = {
  host: '',
  port: DEFAULT_PORT,
  override_mode: 'temporary',
  language: 'en',
  debug_logs: false,
};

const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return fallback;
};

/**
 * @description "192.168.1.20", "otgw.local:25238", "[fd00::5]:7686",
 * "socket://192.168.1.20:25238" (the Home Assistant form) -> host and port.
 * @param {string} raw - Address typed by the user.
 * @param {number|string} rawPort - Port setting.
 * @returns {{ host: string, port: number }} Host ('' when none) and port.
 */
export function parseAddress(raw, rawPort) {
  let host = String(raw ?? '')
    .trim()
    .replace(/^(tcp|socket|telnet):\/\//i, '')
    .replace(/\/.*$/, '');
  let port = Number(rawPort);
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(host);
  if (bracketed) {
    host = bracketed[1];
    if (bracketed[2]) {
      port = Number(bracketed[2]);
    }
  } else if ((host.match(/:/g) ?? []).length === 1) {
    const [name, typedPort] = host.split(':');
    host = name;
    if (/^\d+$/.test(typedPort)) {
      port = Number(typedPort);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    port = DEFAULT_PORT;
  }
  return { host, port };
}

/**
 * @description Normalize the raw configuration.
 * @param {object} raw - `gladys.config` or the `onConfigUpdated` payload.
 * @returns {object} `{ host, port, overrideMode, language, debugLogs }`.
 */
export function normalizeConfig(raw = {}) {
  const { host, port } = parseAddress(raw.host ?? DEFAULTS.host, raw.port ?? DEFAULTS.port);
  return {
    host,
    port,
    overrideMode: OVERRIDE_MODES.includes(raw.override_mode)
      ? raw.override_mode
      : DEFAULTS.override_mode,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULTS.language,
    debugLogs: bool(raw.debug_logs, DEFAULTS.debug_logs),
  };
}
