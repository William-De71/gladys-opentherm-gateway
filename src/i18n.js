// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration button, widgets, connection status); `text(key, language,
// vars)` returns one string (feature and device names, text states, scene
// action errors: Gladys does not send the language of the user with a scan,
// a command or a scene action, see `language` in config.js). `number(value,
// digits)` formats a number the way each language writes it.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

const m = (en, fr, de, es) => ({ en, fr, de, es });

const MESSAGES = {
  // --- Devices and features --------------------------------------------------------------------
  device_boiler: m('Boiler', 'Chaudière', 'Heizkessel', 'Caldera'),
  device_thermostat: m('Room thermostat', 'Thermostat d’ambiance', 'Raumthermostat', 'Termostato'),
  feature_flame: m('Flame', 'Flamme', 'Flamme', 'Llama'),
  feature_ch_active: m('Heating active', 'Chauffage en cours', 'Heizbetrieb', 'Calefacción activa'),
  feature_dhw_active: m(
    'Hot water active',
    'Eau chaude en cours',
    'Warmwasserbereitung',
    'Agua caliente activa',
  ),
  feature_fault: m('Fault', 'Défaut', 'Störung', 'Avería'),
  feature_fault_details: m(
    'Fault details',
    'Détail du défaut',
    'Störungsdetails',
    'Detalle de la avería',
  ),
  feature_modulation: m('Modulation', 'Modulation', 'Modulation', 'Modulación'),
  feature_flow_temperature: m(
    'Flow temperature',
    'Température de départ',
    'Vorlauftemperatur',
    'Temperatura de impulsión',
  ),
  feature_return_temperature: m(
    'Return temperature',
    'Température de retour',
    'Rücklauftemperatur',
    'Temperatura de retorno',
  ),
  feature_control_setpoint: m(
    'Flow temperature asked',
    'Consigne de départ demandée',
    'Angeforderte Vorlauftemperatur',
    'Consigna de impulsión pedida',
  ),
  feature_max_flow_setpoint: m(
    'Maximum flow temperature',
    'Température de départ maximale',
    'Maximale Vorlauftemperatur',
    'Temperatura de impulsión máxima',
  ),
  feature_pressure: m('Water pressure', 'Pression d’eau', 'Wasserdruck', 'Presión del agua'),
  feature_dhw_temperature: m(
    'Hot water temperature',
    'Température eau chaude',
    'Warmwassertemperatur',
    'Temperatura del agua caliente',
  ),
  feature_dhw_setpoint: m(
    'Hot water target',
    'Consigne eau chaude',
    'Warmwasser-Solltemperatur',
    'Consigna de agua caliente',
  ),
  feature_dhw_enable: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  feature_outside_temperature: m(
    'Outside temperature',
    'Température extérieure',
    'Außentemperatur',
    'Temperatura exterior',
  ),
  feature_exhaust_temperature: m(
    'Exhaust temperature',
    'Température des fumées',
    'Abgastemperatur',
    'Temperatura de humos',
  ),
  feature_burner_starts: m(
    'Burner starts',
    'Démarrages brûleur',
    'Brennerstarts',
    'Arranques del quemador',
  ),
  feature_ch_pump_starts: m(
    'Heating pump starts',
    'Démarrages pompe chauffage',
    'Starts Heizungspumpe',
    'Arranques bomba calefacción',
  ),
  feature_dhw_pump_starts: m(
    'Hot water pump starts',
    'Démarrages pompe eau chaude',
    'Starts Warmwasserpumpe',
    'Arranques bomba agua caliente',
  ),
  feature_dhw_burner_starts: m(
    'Hot water burner starts',
    'Démarrages brûleur eau chaude',
    'Brennerstarts Warmwasser',
    'Arranques quemador agua caliente',
  ),
  feature_burner_hours: m('Burner hours', 'Heures brûleur', 'Brennerstunden', 'Horas del quemador'),
  feature_ch_pump_hours: m(
    'Heating pump hours',
    'Heures pompe chauffage',
    'Stunden Heizungspumpe',
    'Horas bomba calefacción',
  ),
  feature_dhw_pump_hours: m(
    'Hot water pump hours',
    'Heures pompe eau chaude',
    'Stunden Warmwasserpumpe',
    'Horas bomba agua caliente',
  ),
  feature_dhw_burner_hours: m(
    'Hot water burner hours',
    'Heures brûleur eau chaude',
    'Brennerstunden Warmwasser',
    'Horas quemador agua caliente',
  ),
  feature_room_temperature: m(
    'Room temperature',
    'Température ambiante',
    'Raumtemperatur',
    'Temperatura ambiente',
  ),
  feature_room_setpoint: m(
    'Room setpoint',
    'Consigne ambiante',
    'Raum-Solltemperatur',
    'Consigna ambiente',
  ),
  feature_override_active: m(
    'Setpoint imposed by Gladys',
    'Consigne imposée par Gladys',
    'Sollwert von Gladys vorgegeben',
    'Consigna impuesta por Gladys',
  ),

  // --- Faults ----------------------------------------------------------------------------------
  faultNone: m('No fault', 'Aucun défaut', 'Keine Störung', 'Sin avería'),
  faultUnknown: m(
    'Fault (no details from the boiler)',
    'Défaut (sans détail de la chaudière)',
    'Störung (keine Details vom Kessel)',
    'Avería (sin detalle de la caldera)',
  ),
  faultCode: m('Code {code}', 'Code {code}', 'Code {code}', 'Código {code}'),
  fault_low_water_pressure: m(
    'low water pressure',
    'pression d’eau basse',
    'Wasserdruck zu niedrig',
    'presión de agua baja',
  ),
  fault_gas_flame_fault: m('gas or flame', 'gaz ou flamme', 'Gas oder Flamme', 'gas o llama'),
  fault_air_pressure_fault: m('air pressure', 'pression d’air', 'Luftdruck', 'presión de aire'),
  fault_water_over_temperature: m(
    'water too hot',
    'eau trop chaude',
    'Wasser zu heiß',
    'agua demasiado caliente',
  ),

  // --- Connection status (integration page) ----------------------------------------------------
  statusNoHost: m(
    'Enter the address of your OpenTherm Gateway.',
    'Indiquez l’adresse de votre OpenTherm Gateway.',
    'Geben Sie die Adresse Ihres OpenTherm Gateway ein.',
    'Indique la dirección de su OpenTherm Gateway.',
  ),
  statusConnecting: m(
    'Connecting to the gateway…',
    'Connexion à la passerelle…',
    'Verbindung zum Gateway…',
    'Conectando con la pasarela…',
  ),
  statusUnreachable: m(
    'The gateway at {address} does not answer: {error}',
    'La passerelle {address} ne répond pas : {error}',
    'Das Gateway {address} antwortet nicht: {error}',
    'La pasarela {address} no responde: {error}',
  ),
  statusNoTraffic: m(
    'Connected, waiting for the OpenTherm traffic between thermostat and boiler.',
    'Connecté, en attente des échanges OpenTherm entre thermostat et chaudière.',
    'Verbunden, warte auf den OpenTherm-Verkehr zwischen Thermostat und Kessel.',
    'Conectado, esperando el tráfico OpenTherm entre termostato y caldera.',
  ),
  statusConnected: m(
    'Connected to OpenTherm Gateway {version}.',
    'Connecté à l’OpenTherm Gateway {version}.',
    'Mit OpenTherm Gateway {version} verbunden.',
    'Conectado a OpenTherm Gateway {version}.',
  ),
  statusMonitor: m(
    'Connected to OpenTherm Gateway {version}, in monitor mode: Gladys reads but cannot change anything.',
    'Connecté à l’OpenTherm Gateway {version}, en mode moniteur : Gladys lit mais ne peut rien modifier.',
    'Mit OpenTherm Gateway {version} im Monitor-Modus verbunden: Gladys liest, kann aber nichts ändern.',
    'Conectado a OpenTherm Gateway {version}, en modo monitor: Gladys lee pero no puede cambiar nada.',
  ),

  // --- Errors (commands, scene actions) --------------------------------------------------------
  errorNoHost: m(
    'The address of the gateway is not set.',
    'L’adresse de la passerelle n’est pas renseignée.',
    'Die Adresse des Gateways ist nicht eingestellt.',
    'La dirección de la pasarela no está configurada.',
  ),
  errorUnreachable: m(
    'The gateway at {address} does not answer: {error}',
    'La passerelle {address} ne répond pas : {error}',
    'Das Gateway {address} antwortet nicht: {error}',
    'La pasarela {address} no responde: {error}',
  ),
  errorMonitor: m(
    'The gateway is in monitor mode: switch it to gateway mode (GW=1) to change settings.',
    'La passerelle est en mode moniteur : passez-la en mode passerelle (GW=1) pour modifier les réglages.',
    'Das Gateway ist im Monitor-Modus: auf Gateway-Modus (GW=1) umstellen, um Einstellungen zu ändern.',
    'La pasarela está en modo monitor: pásela a modo pasarela (GW=1) para cambiar ajustes.',
  ),
  errorTooSoon: m(
    'This setting is kept in the memory of the gateway: try again in {seconds} s.',
    'Ce réglage est gardé dans la mémoire de la passerelle : réessayez dans {seconds} s.',
    'Diese Einstellung wird im Speicher des Gateways gehalten: in {seconds} s erneut versuchen.',
    'Este ajuste se guarda en la memoria de la pasarela: inténtelo de nuevo en {seconds} s.',
  ),
  errorRefused: m(
    'The gateway refused the command ({code}).',
    'La passerelle a refusé la commande ({code}).',
    'Das Gateway hat den Befehl abgelehnt ({code}).',
    'La pasarela rechazó el comando ({code}).',
  ),
  errorRange: m(
    'The value must be between {min} and {max}.',
    'La valeur doit être comprise entre {min} et {max}.',
    'Der Wert muss zwischen {min} und {max} liegen.',
    'El valor debe estar entre {min} y {max}.',
  ),
  errorRangeOrZero: m(
    'The value must be 0 (back to the thermostat) or between {min} and {max}.',
    'La valeur doit être 0 (retour au thermostat) ou comprise entre {min} et {max}.',
    'Der Wert muss 0 (zurück an den Thermostat) oder zwischen {min} und {max} sein.',
    'El valor debe ser 0 (vuelta al termostato) o estar entre {min} y {max}.',
  ),
  errorReadOnly: m(
    'This value can only be read.',
    'Cette valeur est en lecture seule.',
    'Dieser Wert kann nur gelesen werden.',
    'Este valor es solo de lectura.',
  ),
  errorUnknownDevice: m(
    'Unknown device: run a new discovery.',
    'Appareil inconnu : relancez une découverte.',
    'Unbekanntes Gerät: Suche erneut starten.',
    'Dispositivo desconocido: inicie una nueva búsqueda.',
  ),
  errorHotWaterMode: m(
    'Choose on, off or thermostat.',
    'Choisissez marche, arrêt ou thermostat.',
    'Wählen Sie Ein, Aus oder Thermostat.',
    'Elija encendido, apagado o termostato.',
  ),
  errorUnknownAction: m(
    'Unknown action.',
    'Action inconnue.',
    'Unbekannte Aktion.',
    'Acción desconocida.',
  ),

  // --- Configuration button --------------------------------------------------------------------
  testUnreachable: m(
    'No connection to {address}: {error}. Check the address, the port and that the TCP serial port of the gateway is enabled.',
    'Pas de connexion à {address} : {error}. Vérifiez l’adresse, le port et que le port série TCP de la passerelle est activé.',
    'Keine Verbindung zu {address}: {error}. Prüfen Sie Adresse, Port und ob der serielle TCP-Port des Gateways aktiviert ist.',
    'Sin conexión con {address}: {error}. Compruebe la dirección, el puerto y que el puerto serie TCP de la pasarela está activado.',
  ),
  testNotOtgw: m(
    'Something answers at {address}, but not an OpenTherm Gateway ({error}).',
    'Quelque chose répond à {address}, mais pas une OpenTherm Gateway ({error}).',
    'Unter {address} antwortet etwas, aber kein OpenTherm Gateway ({error}).',
    'Algo responde en {address}, pero no una OpenTherm Gateway ({error}).',
  ),
  testOk: m(
    'OpenTherm Gateway {version} found.',
    'OpenTherm Gateway {version} trouvée.',
    'OpenTherm Gateway {version} gefunden.',
    'OpenTherm Gateway {version} encontrada.',
  ),
  testGateway: m(
    'Gateway mode: Gladys can change settings.',
    'Mode passerelle : Gladys peut modifier les réglages.',
    'Gateway-Modus: Gladys kann Einstellungen ändern.',
    'Modo pasarela: Gladys puede cambiar ajustes.',
  ),
  testMonitor: m(
    'Monitor mode: Gladys only reads.',
    'Mode moniteur : Gladys ne fait que lire.',
    'Monitor-Modus: Gladys liest nur.',
    'Modo monitor: Gladys solo lee.',
  ),
  testFeatures: m(
    'Values seen: {list}.',
    'Valeurs vues : {list}.',
    'Gesehene Werte: {list}.',
    'Valores vistos: {list}.',
  ),
  testNoTraffic: m(
    'No OpenTherm traffic yet: is the thermostat wired to the gateway and the boiler on?',
    'Aucun échange OpenTherm pour l’instant : le thermostat est-il raccordé à la passerelle et la chaudière allumée ?',
    'Noch kein OpenTherm-Verkehr: Ist der Thermostat am Gateway angeschlossen und der Kessel an?',
    'Aún no hay tráfico OpenTherm: ¿está el termostato conectado a la pasarela y la caldera encendida?',
  ),
  toastOverrideCancelled: m(
    'The thermostat follows its program again.',
    'Le thermostat suit de nouveau son programme.',
    'Der Thermostat folgt wieder seinem Programm.',
    'El termostato vuelve a seguir su programa.',
  ),

  // --- Widgets ---------------------------------------------------------------------------------
  widgetNoHost: m(
    'Enter the address of the gateway in the integration settings.',
    'Indiquez l’adresse de la passerelle dans les réglages de l’intégration.',
    'Adresse des Gateways in den Einstellungen der Integration eingeben.',
    'Indique la dirección de la pasarela en los ajustes de la integración.',
  ),
  widgetWaiting: m(
    'Waiting for the first OpenTherm values…',
    'En attente des premières valeurs OpenTherm…',
    'Warte auf die ersten OpenTherm-Werte…',
    'Esperando los primeros valores OpenTherm…',
  ),
  widgetUnreachable: m(
    'The gateway does not answer.',
    'La passerelle ne répond pas.',
    'Das Gateway antwortet nicht.',
    'La pasarela no responde.',
  ),
  widgetAddDevice: m(
    'Add the boiler and thermostat (Discover tab) to see their curves.',
    'Ajoutez chaudière et thermostat (onglet Découverte) pour voir les courbes.',
    'Kessel und Thermostat hinzufügen (Tab Suche), um die Kurven zu sehen.',
    'Añada caldera y termostato (pestaña Búsqueda) para ver las curvas.',
  ),
  widgetFlow: m('Flow', 'Départ', 'Vorlauf', 'Impulsión'),
  widgetReturn: m('Return', 'Retour', 'Rücklauf', 'Retorno'),
  widgetRoom: m('Room', 'Ambiance', 'Raum', 'Ambiente'),
  widgetHotWater: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  widgetModulation: m('Modulation', 'Modulation', 'Modulation', 'Modulación'),
  widgetPressure: m('Pressure', 'Pression', 'Druck', 'Presión'),
  widgetOutdoor: m('Outdoor', 'Extérieur', 'Außen', 'Exterior'),
  widgetFlowTarget: m('Flow target', 'Consigne départ', 'Vorlauf-Soll', 'Consigna impulsión'),
  widgetGateway: m('Gateway', 'Passerelle', 'Gateway', 'Pasarela'),
  widgetOffline: m('No answer', 'Ne répond pas', 'Keine Antwort', 'No responde'),
  widgetFault: m('Fault', 'Défaut', 'Störung', 'Avería'),
  widgetNone: m('None', 'Aucun', 'Keine', 'Ninguna'),
  widgetBurner: m('Burner', 'Brûleur', 'Brenner', 'Quemador'),
  widgetHeating: m('Heating', 'Chauffage', 'Heizung', 'Calefacción'),
  widgetHotWaterActive: m('Hot water', 'Eau chaude', 'Warmwasser', 'Agua caliente'),
  widgetOn: m('On', 'En marche', 'Ein', 'Encendido'),
  widgetOff: m('Off', 'Arrêt', 'Aus', 'Apagado'),
  widgetOverride: m('Imposed setpoint', 'Consigne imposée', 'Vorgabe', 'Consigna impuesta'),
  widgetThermostat: m('Thermostat', 'Thermostat', 'Thermostat', 'Termostato'),
  widgetNoThermostat: m('Disconnected', 'Déconnecté', 'Getrennt', 'Desconectado'),
  widgetMonitorMode: m('Monitor mode', 'Mode moniteur', 'Monitor-Modus', 'Modo monitor'),
  widgetCancelOverride: m(
    'Back to the program',
    'Revenir au programme',
    'Zurück zum Programm',
    'Volver al programa',
  ),
  widgetTemperatures: m('Temperatures', 'Températures', 'Temperaturen', 'Temperaturas'),
};

/**
 * @description A number formatted for each language.
 * @param {number} value - The number.
 * @param {number} digits - Decimals.
 * @param {string} [unit] - Unit appended after a non-breaking space.
 * @returns {{en: string, fr: string, de: string, es: string}} The texts.
 */
export function number(value, digits, unit = '') {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const formatted = new Intl.NumberFormat(LOCALES[language], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        // Spanish skips the separator below 10 000: keep it everywhere.
        useGrouping: 'always',
      }).format(value);
      return [language, unit ? `${formatted}\u00a0${unit}` : formatted];
    }),
  );
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
