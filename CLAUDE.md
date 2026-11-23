# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for **OpenTherm boilers and room
thermostats** through the [OpenTherm Gateway](https://otgw.tclcode.com/)
(OTGW, by Schelte Bron), the board that sits on the two OpenTherm wires
between the thermostat and the boiler. A Node.js service (Node 22+, ESM, no
build step; only dependency: the SDK) in its own sandboxed Docker container,
talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the gateway **on the local network only** (`transports: ["local"]`),
through its serial port bridged on TCP: the "Legacy TCP port 25238" of the
NodoShop OTGW-firmware, or ser2net for a USB / serial gateway.

A **device integration** (`type: "device"`, Gladys 5.3.0+: catalog keywords,
widgets and scenes). The client in `src/otgw/` was written from the firmware
documentation and the OpenTherm 2.2 message layout: no code copied (see
NOTICE).

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "hot water"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg (Inkscape, ImageMagick)
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: identification, readings, discovery, commands, scene events and actions, widgets, status
src/otgw/client.js           TCP client: one connection, lines to the app, one command at a time (timeout, 3 tries, OE), reconnect
src/otgw/protocol.js         pure: gateway lines (messages, replies, errors, events), f8.8 / u16 / s16, command lines
src/otgw/opentherm.js        pure: data ids -> features (Gladys shapes, bounds, rounding), which lines carry a value
src/devices.js               features -> the boiler and thermostat devices, names
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, event data, outputs
src/widgets.js               the boiler and history widgets (pure, reused by docs/illustrations)
src/i18n.js                  runtime texts in en / fr / de / es, numbers per language
src/storage.js               JSON file in /data (seen.json: the data ids seen)
src/config.js                config_schema -> { host, port, overrideMode, language, debugLogs }
test/helpers/fake-otgw.js    a fake gateway on a real local socket (commands answered, lines printed)
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:boiler:otgw[:{key}]` and
  `ext:{selector}:thermostat:otgw[:{key}]`, the keys of `FEATURES` in
  `src/otgw/opentherm.js`. Config, action, field, widget, trigger, variable
  and output keys too.
- **Feature fields** compared by the Discover "Update" (category, type, unit,
  min, max, step, features added or removed) are decided in
  `src/otgw/opentherm.js` only.
- **Commands change the heating of a house**: only those of the code (PR, PS,
  TT, TC, OT, HW, SW, SH), values checked against the bounds of
  `src/otgw/opentherm.js`; refused in monitor mode; SW and SH are kept in the
  memory of the gateway: never the same value twice, one a minute. Never send
  GW, AA/DA, LA–LF, GA/GB, VR or any other command that changes the gateway
  itself.
- **The traffic is fast** (a message a second): binary values go to Gladys at
  once, numbers at most every 15 s (`sampleMs`), rounded (`digits`).
- **Scene events**: one per transition seen; never fired by a command or a
  scene action; the first value of a fault is not news.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 focal, 6 tiles, 1 status, 4
  buttons. Tile labels fit about 12 characters, captions 80.
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.

## Pitfalls

- A line is a letter and 8 hex digits: T thermostat, B boiler, R / A the
  gateway's modified request / answer, E a line error. The type is bits 4–6
  of the first byte (bit 7 is parity).
- Values: a boiler Read-Ack / Write-Ack (B or A), a thermostat Write-Data (T
  or R). Room temperature (24) and room setpoint (16) are written by the
  thermostat: a boiler that does not know them answers Unknown-DataId, the
  value is still good.
- Data id 0 carries the master flags (high byte: CH / DHW enable) and the
  slave flags (low byte: fault, CH, DHW, flame) in the boiler answer.
- A command is answered `TT: 20.50` or by an error code alone on its line
  (NG, SE, BV, OR, NS, NF, OE): the client takes it for the command waiting.
- The data ids a thermostat asks for depend on its model: a feature appears
  when its id is first seen (discovery published again), kept in
  /data/seen.json so a restart does not shrink the devices.
- TT / TC only work with a thermostat that supports the remote override (data
  id 9). The setpoint shown at once is the one asked for; data id 16 follows.
- `localhost` does not reach the gateway from the integration container.
- `node --test` also runs the files of `test/helpers/`: they must not start
  anything on import.
- A top-level `const SVG` in `docs/illustrations/render.js` shadows the global
  of ApexCharts (charts render empty): it is `SVG_NS`.
- Gladys does not send the user's language with a scan or a command: device
  and feature names, text states and scene errors use the `language`
  setting.
- Never tested on a real gateway: when a user reports a difference, add their
  lines (detailed log) to the tests first, then fix the code.
