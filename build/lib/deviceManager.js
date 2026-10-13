"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const dm_utils_1 = require("@iobroker/dm-utils");
const firmware_1 = require("./firmware");
const discovery_1 = require("./discovery");
/** How long the firmware update of a device may take, including the download and the restart */
const FIRMWARE_UPDATE_TIMEOUT = 5 * 60 * 1000;
/** Icon shown for every device, since the adapter does not ship per-model icons */
const DEVICE_ICON = 'adapter/sonoff/admin/sonoff.png';
/** Group metadata: display name key (for i18n) */
const groupMeta = {
    relay: { nameKey: 'Relays & Switches' },
    light: { nameKey: 'Lights & Dimmers' },
    cover: { nameKey: 'Shutters & Covers' },
    zigbee: { nameKey: 'Zigbee bridges' },
    meter: { nameKey: 'Energy Meters' },
    sensor: { nameKey: 'Sensors' },
    other: { nameKey: 'Other' },
};
/** Well-known sensor data points shown on the main tile */
const SENSOR_ITEMS = [
    { stateId: 'Temperature', label: 'Temperature', unit: '°C', digits: 1 },
    { stateId: 'Humidity', label: 'Humidity', unit: '%', digits: 1 },
    { stateId: 'Pressure', label: 'Pressure', unit: 'hPa', digits: 1 },
    { stateId: 'Illuminance', label: 'Illuminance', unit: 'lx', digits: 0 },
    { stateId: 'CarbonDioxide', label: 'CO2', unit: 'ppm', digits: 0 },
    { stateId: 'TVOC', label: 'TVOC', unit: 'ppb', digits: 0 },
    { stateId: 'DewPoint', label: 'Dew point', unit: '°C', digits: 1 },
];
/**
 * Power-metering data points, keyed by their data point name (see `lib/datapoints.js`). Sonoff/Tasmota
 * devices have no fixed "model" that tells us which power values to expect, and unlike the built-in
 * `ENERGY.*` group, bridged external meters (SML smart-meter heads, PZEM sensors, ...) publish the same
 * data points nested under their own custom group name, e.g. `SML_Total_in`. So instead of only looking
 * at one fixed state ID, every state belonging to a device is matched against this table by its data
 * point name (the last path segment) - wherever it is found, the same way ioBroker.shelly reads its
 * power values from whichever states actually exist on a device (see shelly PR #1562).
 */
const POWER_METRIC_LABELS = {
    Power: { label: 'Power', unit: 'W', order: 0 },
    Power_curr: { label: 'Power', unit: 'W', order: 0 },
    Leistung: { label: 'Power', unit: 'W', order: 0 },
    ApparentPower: { label: 'Apparent power', unit: 'VA', order: 1 },
    ReactivePower: { label: 'Reactive power', unit: 'var', order: 2 },
    Voltage: { label: 'Voltage', unit: 'V', order: 3 },
    Spannung: { label: 'Voltage', unit: 'V', order: 3 },
    Current: { label: 'Current', unit: 'A', order: 4 },
    Strom: { label: 'Current', unit: 'A', order: 4 },
    CurrentNeutral: { label: 'Neutral current', unit: 'A', order: 5 },
    Factor: { label: 'Power factor', unit: '', order: 6 },
    Frequency: { label: 'Frequency', unit: 'Hz', order: 7 },
    Frequenz: { label: 'Frequency', unit: 'Hz', order: 7 },
    Today: { label: 'Today', unit: 'kWh', order: 8 },
    heute: { label: 'Today', unit: 'kWh', order: 8 },
    TodaySumImport: { label: 'Today (import)', unit: 'kWh', order: 8 },
    TodaySumExport: { label: 'Today (export)', unit: 'kWh', order: 9 },
    Yesterday: { label: 'Yesterday', unit: 'kWh', order: 10 },
    gestern: { label: 'Yesterday', unit: 'kWh', order: 10 },
    Total: { label: 'Total', unit: 'kWh', order: 11 },
    Total_in: { label: 'Total (import)', unit: 'kWh', order: 11 },
    Total_out: { label: 'Total (export)', unit: 'kWh', order: 12 },
    ExportActive: { label: 'Returned energy', unit: 'kWh', order: 12 },
    PowerLow: { label: 'Power low threshold', unit: 'W', order: 14 },
    PowerHigh: { label: 'Power high threshold', unit: 'W', order: 15 },
    PowerDelta: { label: 'Power delta threshold', unit: 'W', order: 16 },
};
/** Fields taken from `INFO.*` (filled from Tasmota's `StatusNET`/`StatusFWR`) for the details panel */
const INFO_ITEMS = [
    { stateId: 'Module', label: 'Model' },
    { stateId: 'Hostname', label: 'Hostname' },
    { stateId: 'IPAddress', label: 'IP address', copy: true },
    { stateId: 'Mac', label: 'MAC address', copy: true },
    { stateId: 'Gateway', label: 'Gateway' },
    { stateId: 'Subnetmask', label: 'Subnet mask' },
    { stateId: 'Hardware', label: 'Hardware' },
    { stateId: 'BuildDateTime', label: 'Build date' },
    { stateId: 'Core', label: 'Core' },
    { stateId: 'SDK', label: 'SDK' },
];
/**
 * Splits a state suffix into the group it belongs to and the data point name, e.g.
 * "ENERGY.Voltage" -> { channel: "ENERGY", key: "Voltage" }, "SML_Total_in" (a bridged external
 * meter nested under a custom "SML" group) -> { channel: "SML", key: "Total_in" }, and
 * "SENSOR.ENERGY.Power" (nested two levels deep with the "Create object tree" option enabled) ->
 * { channel: "SENSOR.ENERGY", key: "Power" }. A bare data point without any group, e.g. "Voltage",
 * resolves to `{ channel: "", key: "Voltage" }`. Returns `undefined` if the suffix's data point name
 * (last path segment, or underscore-joined tail) isn't one of `knownKeys`.
 *
 * @param suffix state ID without the device prefix
 * @param knownKeys data point names to match against, e.g. the keys of `POWER_METRIC_LABELS`
 */
function splitDataPoint(suffix, knownKeys) {
    const lastDotIdx = suffix.lastIndexOf('.');
    if (lastDotIdx > -1) {
        const key = suffix.substring(lastDotIdx + 1);
        return knownKeys.includes(key) ? { channel: suffix.substring(0, lastDotIdx), key } : undefined;
    }
    if (knownKeys.includes(suffix)) {
        return { channel: '', key: suffix };
    }
    for (const key of knownKeys) {
        if (suffix.endsWith(`_${key}`)) {
            return { channel: suffix.substring(0, suffix.length - key.length - 1), key };
        }
    }
    return undefined;
}
/**
 * A channel's leading "SENSOR."/"STATE."/"RESULT."/"WAKEUP." segment is only there because the
 * "Create object tree" (OBJ_TREE) option is/was enabled - it does not identify a different meter.
 * Stripping it gives the channel identity that is stable across that setting, so the same physical
 * meter (e.g. the built-in ENERGY group) is recognized as one meter even if its states exist twice,
 * once from before and once from after the option was toggled.
 */
function canonicalizeChannel(channel) {
    return channel.replace(/^(SENSOR|STATE|RESULT|WAKEUP)\./, '');
}
/**
 * Whether a (raw, non-canonicalized) channel was nested under one of the topic-level groups created
 * by the "Create object tree" (OBJ_TREE) adapter option, e.g. "SENSOR.ENERGY" or "STATE.Wifi".
 */
function isObjTreeStyleChannel(channel) {
    return /^(SENSOR|STATE|RESULT|WAKEUP)\./.test(channel);
}
/**
 * The suffix of a state as it looks with the "Create object tree" (OBJ_TREE) option turned off. That
 * option changes nothing about which data points a device has, it only moves them into a folder per
 * MQTT topic group and nests the payload path instead of joining it with "_":
 *
 * | OBJ_TREE on                  | OBJ_TREE off           | flatName             |
 * | ---------------------------- | ---------------------- | -------------------- |
 * | `RESULT.Dimmer`              | `Dimmer`               | `Dimmer`             |
 * | `RESULT.Shutter1.Position`   | `Shutter1_Position`    | `Shutter1_Position`  |
 * | `STATE.Wifi.RSSI`            | `Wifi_RSSI`            | `Wifi_RSSI`          |
 * | `SENSOR.AM2301.Temperature`  | `AM2301_Temperature`   | `AM2301_Temperature` |
 *
 * Both settings therefore end up at the same name, so everything that recognizes a device by its data
 * points (see `getDeviceGroup` and `buildControls`) works the same with and without the option.
 */
function flatName(suffix) {
    return suffix.replace(/^(SENSOR|STATE|RESULT|WAKEUP)\./, '').replace(/\./g, '_');
}
/**
 * Data point names that make a device a sensor. Matched against the flattened suffix
 * (see `flatName`) either as the whole name or as its "_"-separated tail, because Tasmota puts the
 * name of the reporting sensor in front of the reading, e.g. "AM2301_Temperature".
 */
const SENSOR_KEYS = [
    'Temperature',
    'Humidity',
    'Pressure',
    'Illuminance',
    'CarbonDioxide',
    'TVOC',
    'eCO2',
    'DewPoint',
    'AirQuality',
    'PM2_5',
    'PM10',
    'UvIndex',
    'Distance',
    'Noise',
];
/**
 * DeviceManager Class
 */
class SonoffDeviceManagement extends dm_utils_1.DeviceManagement {
    ready;
    states = {};
    objects = {};
    /** Version of the latest Tasmota release, see `setLatestFirmware` */
    latestFirmware = null;
    constructor(adapter) {
        // `true` creates `info.deviceManager` - the state through which the adapter updates an open device
        // manager, e.g. when a device goes offline or a new firmware is available
        super(adapter, true);
        // Initialize i18n
        this.ready = adapter_core_1.I18n.init(__dirname, adapter)
            .catch(error => this.adapter.log.error(`Cannot initialize i18n: ${error}`))
            .then(() => this.init());
    }
    async init() {
        const channels = await this.adapter.getChannelsOfAsync();
        const stateObjects = await this.adapter.getStatesOfAsync();
        const states = await this.adapter.getStatesAsync('*');
        for (const channel of channels) {
            this.objects[channel._id] = channel;
        }
        for (const state of stateObjects) {
            this.objects[state._id] = state;
        }
        for (const id in states) {
            this.states[id] = states[id];
        }
        await this.adapter.subscribeStatesAsync('*');
        await this.adapter.subscribeObjectsAsync('*');
    }
    getInstanceInfo() {
        return {
            apiVersion: 'v3',
            smallCards: true,
            communicationStateId: `${this.adapter.namespace}.info.deviceManager`,
            actions: [
                {
                    id: 'discover',
                    icon: 'search',
                    title: adapter_core_1.I18n.getTranslatedObject('Search for devices'),
                    description: adapter_core_1.I18n.getTranslatedObject('Search the network for Tasmota devices and connect them with ioBroker'),
                    timeout: 120_000,
                    handler: async (context) => await this.handleDiscoverDevices(context),
                },
            ],
        };
    }
    /**
     * MQTT settings the devices need to connect with ioBroker: the built-in server of the adapter or, in
     * bridge mode, the external broker
     *
     * @param deviceIp address of a found device, to find the own address in its network
     */
    getMqttDefaults(deviceIp) {
        const config = this.adapter.config;
        if (config.useExternalBroker && config.externalBrokerUrl) {
            try {
                const url = new URL(config.externalBrokerUrl.includes('://')
                    ? config.externalBrokerUrl
                    : `mqtt://${config.externalBrokerUrl}`);
                return {
                    host: url.hostname,
                    port: parseInt(url.port, 10) || (url.protocol === 'mqtts:' ? 8883 : 1883),
                    user: config.externalBrokerUser || '',
                    password: config.externalBrokerPassword || '',
                };
            }
            catch {
                // invalid URL, use the own address
            }
        }
        return {
            host: (0, discovery_1.getLocalIp)(deviceIp) || '',
            port: parseInt(config.port, 10) || 1883,
            user: config.user || '',
            password: config.password || '',
        };
    }
    /**
     * Searches the network for Tasmota devices and connects the selected ones with ioBroker: enables MQTT
     * and writes the address, the port and the credentials of the MQTT server. The devices restart and
     * appear in the list as soon as they are connected.
     *
     * @param context context to show the progress and the forms
     * @param addresses addresses to ask, by default the local networks (for tests)
     */
    async handleDiscoverDevices(context, addresses) {
        await this.ready;
        const progress = await context.openProgress(adapter_core_1.I18n.getTranslatedObject('Searching for Tasmota devices...'), {
            value: 0,
        });
        // Every message to the GUI is the answer to the previous one, so a progress update may only be sent
        // after the previous one was confirmed - otherwise the answers get mixed up and "close" is lost
        const pending = { update: null };
        let lastPercent = 0;
        let found;
        try {
            found = await (0, discovery_1.scanNetwork)((done, total) => {
                const percent = Math.floor((done / total) * 100);
                if (percent !== lastPercent && !pending.update) {
                    lastPercent = percent;
                    pending.update = progress.update({ value: percent }).finally(() => (pending.update = null));
                }
            }, addresses);
        }
        finally {
            await pending.update;
            await progress.close();
        }
        if (!found.length) {
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('No Tasmota devices found'));
            return { refresh: false };
        }
        // A device which is connected with this instance needs no configuration
        const connected = new Set();
        for (const id in this.states) {
            const match = id.match(/^(.+)\.INFO\.(Mac|IPAddress|Info2_IPAddress)$/);
            if (match && this.states[`${match[1]}.alive`]?.val === true && this.states[id].val) {
                connected.add(String(this.states[id].val).toUpperCase());
            }
        }
        const isConnected = (device) => connected.has(device.ip) || (!!device.mac && connected.has(device.mac.toUpperCase()));
        const candidates = found.filter(device => !isConnected(device));
        const known = found.filter(device => isConnected(device));
        if (!candidates.length) {
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('All %s found devices are already connected', known.length));
            return { refresh: false };
        }
        const defaults = this.getMqttDefaults(found[0].ip);
        const items = {};
        const data = { ...defaults, webPassword: '', selectAll: false };
        const noneSelected = [];
        if (candidates.length) {
            items._mqttHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('MQTT settings'),
                size: 5,
            };
            items.host = { type: 'text', label: adapter_core_1.I18n.getTranslatedObject('MQTT server'), xs: 12, sm: 8, newLine: true };
            items.port = {
                type: 'number',
                label: adapter_core_1.I18n.getTranslatedObject('MQTT port'),
                min: 1,
                max: 65535,
                xs: 12,
                sm: 4,
            };
            items.user = { type: 'text', label: adapter_core_1.I18n.getTranslatedObject('MQTT user'), xs: 12, sm: 6, newLine: true };
            items.password = { type: 'password', label: adapter_core_1.I18n.getTranslatedObject('MQTT password'), xs: 12, sm: 6 };
            items.webPassword = {
                type: 'password',
                label: adapter_core_1.I18n.getTranslatedObject('Web password of the devices'),
                help: adapter_core_1.I18n.getTranslatedObject('Only required for devices with a web password'),
                xs: 12,
                newLine: true,
            };
            items._newHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Devices (%s)', candidates.length),
                size: 5,
            };
            if (candidates.length > 1) {
                items.selectAll = {
                    type: 'checkbox',
                    label: adapter_core_1.I18n.getTranslatedObject('Select all'),
                    xs: 12,
                    newLine: true,
                };
            }
            candidates.forEach((device, i) => {
                let mqtt;
                if (device.protected) {
                    mqtt = adapter_core_1.I18n.translate('password protected');
                }
                else if (!device.mqttEnabled) {
                    mqtt = adapter_core_1.I18n.translate('MQTT disabled');
                }
                else {
                    mqtt = `MQTT: ${device.mqttHost || '?'}:${device.mqttPort || '?'}`;
                }
                items[`add_${i}`] = {
                    type: 'checkbox',
                    label: `${device.name || device.hostname || device.ip} — ${device.ip} (${mqtt})`,
                    xs: 12,
                    newLine: true,
                    onChange: { alsoDependsOn: ['selectAll'], calculateFunc: 'data.selectAll', ignoreOwnChanges: true },
                };
                data[`add_${i}`] = false;
                noneSelected.push(`!data.add_${i}`);
            });
        }
        if (known.length) {
            items._knownHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Already connected (%s)', known.length),
                size: 5,
            };
            known.forEach((device, i) => {
                items[`known_${i}`] = {
                    type: 'staticInfo',
                    label: device.name || device.hostname || device.ip,
                    data: device.ip,
                    addColon: true,
                    newLine: true,
                };
            });
        }
        const result = await context.showForm({ type: 'panel', items }, {
            data,
            title: adapter_core_1.I18n.getTranslatedObject('Connect devices with ioBroker'),
            ...(noneSelected.length
                ? { applyDisabledRule: noneSelected.join(' && ') }
                : { ignoreApplyDisabled: true }),
        });
        const selected = candidates.filter((_device, i) => result?.[`add_${i}`]);
        if (!result || !selected.length) {
            return { refresh: false };
        }
        const settings = {
            host: String(result.host || '').trim(),
            port: parseInt(String(result.port), 10) || 1883,
            user: String(result.user || '').trim(),
            password: String(result.password || ''),
        };
        if (!settings.host) {
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('The MQTT server is missing'));
            return { refresh: false };
        }
        const webPassword = String(result.webPassword || '') || undefined;
        const configProgress = await context.openProgress(adapter_core_1.I18n.getTranslatedObject('Configuring devices...'), {
            value: 0,
        });
        const lines = [];
        for (let i = 0; i < selected.length; i++) {
            const device = selected[i];
            const label = device.name || device.hostname || device.ip;
            await configProgress.update({ value: Math.round((i / selected.length) * 100), label });
            try {
                await (0, discovery_1.configureMqtt)(device.ip, settings, webPassword);
                lines.push(`✓ ${label} (${device.ip})`);
                this.adapter.log.info(`Device ${label} (${device.ip}) connected with MQTT server ${settings.host}`);
            }
            catch (err) {
                const reason = err instanceof discovery_1.TasmotaAuthError
                    ? adapter_core_1.I18n.translate('the web password is missing or wrong')
                    : err.message;
                lines.push(`✗ ${label} (${device.ip}): ${reason}`);
                this.adapter.log.warn(`Cannot configure ${label} (${device.ip}): ${reason}`);
            }
        }
        await configProgress.close();
        await context.showMessage(`${adapter_core_1.I18n.translate('The devices restart and connect with ioBroker')}:\n${lines.join('\n')}`);
        return { refresh: true };
    }
    onStateChange(id, state) {
        const previous = this.states[id];
        if (state) {
            // Also on an unchanged value: the timestamp decides which copy of a data point that exists
            // more than once is the current one (see `buildControls` and `getPowerEntries`)
            this.states[id] = state;
        }
        else if (previous) {
            delete this.states[id];
        }
        if (previous?.val === state?.val) {
            return;
        }
        // Connection, signal and battery are bound to their states (see `buildDeviceStatus`), the GUI
        // follows them by itself
        if (/\.INFO\.(\w+_)?Version$/.test(id) && previous) {
            // A new firmware version (e.g. after an update) changes the update indicator and the actions
            this.refreshGui();
        }
    }
    /**
     * Stores the version of the latest Tasmota release. Devices with an older firmware get the update
     * indicator and the action to update it.
     *
     * @param version e.g. "15.0.1", null if unknown
     */
    setLatestFirmware(version) {
        if (this.latestFirmware !== version) {
            this.latestFirmware = version;
            this.refreshGui();
        }
    }
    /** Reloads all devices in an open device manager */
    refreshGui() {
        this.sendCommandToGui({ command: 'all' }).catch(e => this.adapter.log.debug(`Cannot update the device manager: ${e}`));
    }
    /**
     * Firmware version of a device, e.g. "14.2.0(tasmota)". Tasmota reports it on boot in INFO1
     * ("INFO.Info1_Version", older versions "INFO.Version") and when asked for STATUS2 ("INFO.Version"),
     * so the most recently updated one is the current one.
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    getFirmwareVersion(prefix) {
        let newest;
        for (const id in this.states) {
            if (!id.startsWith(`${prefix}INFO.`) || !/^(\w+_)?Version$/.test(id.substring(prefix.length + 5))) {
                continue;
            }
            const state = this.states[id];
            if ((0, firmware_1.parseVersion)(state?.val) && (!newest || state.ts > newest.ts)) {
                newest = state;
            }
        }
        return newest?.val;
    }
    /**
     * Connection, signal strength and battery of a device, as shown in the header of its card. They are
     * bound to their states, so an open device manager shows every change without reloading the devices.
     *
     * The device manager expects the signal strength in dBm. Tasmota reports it as "Signal" (dBm) and
     * as "RSSI", which is the link quality in percent - so "RSSI" is only used if there is no "Signal"
     * and it is already in dBm (negative, e.g. from a Zigbee device).
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    buildDeviceStatus(prefix) {
        let rssiSuffix = this.findDataPointSuffix(prefix, 'Signal');
        if (!rssiSuffix) {
            const suffix = this.findDataPointSuffix(prefix, 'RSSI');
            const val = suffix ? this.states[`${prefix}${suffix}`]?.val : undefined;
            rssiSuffix = typeof val === 'number' && val < 0 ? suffix : undefined;
        }
        const batterySuffix = this.findDataPointSuffix(prefix, 'BatteryPercentage');
        return {
            connection: {
                stateId: `${prefix}alive`,
                mapping: { true: 'connected', false: 'disconnected' },
            },
            rssi: rssiSuffix ? { stateId: `${prefix}${rssiSuffix}` } : undefined,
            battery: batterySuffix ? { stateId: `${prefix}${batterySuffix}` } : undefined,
        };
    }
    onObjectChange(id, obj) {
        if (obj) {
            this.objects[id] = obj;
        }
        else {
            delete this.objects[id];
        }
    }
    /**
     * Collects the short suffixes (state ID without the device prefix) of all currently known
     * objects that belong to one device, e.g. "POWER1", "ENERGY.Voltage" or "Shutter1_Position".
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    getSuffixes(prefix) {
        const suffixes = new Set();
        for (const id in this.objects) {
            if (id.startsWith(prefix)) {
                suffixes.add(id.substring(prefix.length));
            }
        }
        return suffixes;
    }
    /**
     * Finds a state whose data point name (its last path segment) is `key`, regardless of which group
     * it is nested under - a data point can end up at very different state IDs depending on the
     * "Create object tree" (OBJ_TREE) adapter option and on which MQTT topic published it, e.g. RSSI is
     * "Wifi_RSSI" with OBJ_TREE off but "STATE.Wifi.RSSI" with it on. Returns the matching suffix (state
     * ID without the device prefix), or `undefined` if the device has no such data point.
     *
     * A key can exist under more than one group at once, e.g. Tasmota echoes "Uptime" as part of a
     * one-off command response ("RESULT.Uptime") in addition to reporting it with every regular
     * "STATE" telemetry message - only the latter keeps being updated, so when both exist, the periodic
     * telemetry groups (STATE, then SENSOR) are preferred over anything else.
     *
     * @param prefix `<namespace>.<deviceId>.`
     * @param key data point name, e.g. "RSSI" or "Temperature"
     */
    findDataPointSuffix(prefix, key) {
        const matches = [];
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            if (suffix === key || suffix.endsWith(`.${key}`) || suffix.endsWith(`_${key}`)) {
                matches.push(suffix);
            }
        }
        if (matches.length > 1) {
            for (const group of ['STATE', 'SENSOR']) {
                const preferred = matches.find(s => s.startsWith(`${group}.`));
                if (preferred) {
                    return preferred;
                }
            }
        }
        return matches[0];
    }
    /**
     * Splits a state suffix into the group it belongs to and the power-metering data point name.
     * Thin wrapper around `splitDataPoint` fixed to the keys of `POWER_METRIC_LABELS`, see there.
     *
     * @param suffix state ID without the device prefix
     */
    splitPowerSuffix(suffix) {
        return splitDataPoint(suffix, Object.keys(POWER_METRIC_LABELS));
    }
    /**
     * Human-readable label for a (canonicalized) power-metering channel, used when a device has more
     * than one meter and each one needs to be told apart. The built-in Tasmota group is translated
     * ("ENERGY" -> "Power"/"Leistung"/...); a bridged external meter has no fixed translation - its
     * group name comes directly from the MQTT payload (e.g. "SML", "PZEM"), so it is shown as-is.
     */
    channelLabel(channel) {
        if (channel === 'ENERGY') {
            return adapter_core_1.I18n.getTranslatedObject('Power');
        }
        // Not a second meter, but the alarm thresholds Tasmota reports for the built-in one
        if (channel === 'MARGINS') {
            return adapter_core_1.I18n.getTranslatedObject('Thresholds');
        }
        return channel.replace(/[._]/g, ' ');
    }
    /**
     * Finds all power-metering data points of a device, wherever they are: in the built-in `ENERGY.*`
     * group, in a custom group of a bridged external meter, or as a bare top-level data point.
     *
     * The same reading can end up under more than one state ID for the same meter and metric (channel +
     * label): toggling "Create object tree" moves a data point without deleting the old one, and some
     * Tasmota firmware reports energy readings both nested inside its periodic "SENSOR" telemetry *and*
     * via its own dedicated "ENERGY" topic (both handled by `mqttBase.ts`, see there). Whenever a copy
     * nested under SENSOR/STATE/RESULT/WAKEUP (see `isObjTreeStyleChannel`) exists, it is the
     * authoritative one - a device that also sends its own dedicated topic still sends the regular
     * telemetry that ends up nested, so the bare, non-nested copy is always redundant when a nested one
     * exists. Only as a fallback, when no nested copy exists (or several do, e.g. two aliased data point
     * names), the entry whose state was updated most recently wins - stale leftovers stop being updated,
     * so their timestamp falls behind.
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    getPowerEntries(prefix) {
        const entries = [];
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            const common = this.objects[stateId]?.common;
            if (!common || common.write === true) {
                continue;
            }
            const split = this.splitPowerSuffix(suffix);
            if (!split) {
                continue;
            }
            const meta = POWER_METRIC_LABELS[split.key];
            entries.push({
                suffix,
                channel: split.channel,
                key: split.key,
                label: meta.label,
                unit: meta.unit,
                order: meta.order,
            });
        }
        const byMeter = new Map();
        for (const entry of entries) {
            const groupKey = `${canonicalizeChannel(entry.channel)} ${entry.label}`;
            const group = byMeter.get(groupKey);
            if (group) {
                group.push(entry);
            }
            else {
                byMeter.set(groupKey, [entry]);
            }
        }
        const deduped = [];
        for (const group of byMeter.values()) {
            const nested = group.filter(e => isObjTreeStyleChannel(e.channel));
            const candidates = nested.length ? nested : group;
            const preferred = candidates.reduce((newest, entry) => {
                const newestTs = this.states[`${prefix}${newest.suffix}`]?.ts ?? 0;
                const entryTs = this.states[`${prefix}${entry.suffix}`]?.ts ?? 0;
                return entryTs > newestTs ? entry : newest;
            });
            deduped.push({ ...preferred, channel: canonicalizeChannel(preferred.channel) });
        }
        return deduped.sort((a, b) => a.channel.localeCompare(b.channel) || a.order - b.order);
    }
    /**
     * Load all sonoff/Tasmota devices
     *
     * @param context context used to report the found devices to the backend
     */
    async loadDevices(context) {
        // Wait that i18n is initialized
        await this.ready;
        const ns = this.adapter.namespace;
        for (const deviceId in this.objects) {
            const device = this.objects[deviceId];
            if (device.type !== 'channel') {
                continue;
            }
            const shortDeviceId = device._id.substring(ns.length + 1);
            // Only direct children of the namespace are devices, "info" is the adapter's own channel
            if (!shortDeviceId || shortDeviceId.includes('.') || shortDeviceId === 'info') {
                continue;
            }
            try {
                const prefix = `${device._id}.`;
                const suffixes = this.getSuffixes(prefix);
                const alive = this.states[`${device._id}.alive`]?.val === true;
                const hostname = this.states[`${prefix}INFO.Hostname`]?.val;
                const ip = this.states[`${prefix}INFO.IPAddress`]?.val;
                const model = this.states[`${prefix}INFO.Module`]?.val || undefined;
                const clientId = device.native?.clientId;
                const group = this.getDeviceGroup(suffixes);
                const firmware = this.getFirmwareVersion(prefix);
                const updateAvailable = (0, firmware_1.isNewerVersion)(this.latestFirmware, firmware);
                const res = {
                    id: device._id,
                    identifier: hostname || ip || clientId || undefined,
                    name: device.common?.name || shortDeviceId,
                    icon: DEVICE_ICON,
                    // Red header while the device is offline, follows "alive" without reloading
                    color: { stateId: `${prefix}alive`, mapping: { false: '#fff' } },
                    backgroundColor: { stateId: `${prefix}alive`, mapping: { false: '#f44336' } },
                    group,
                    model,
                    status: this.buildDeviceStatus(prefix),
                    // Only Tasmota devices report a firmware version which can be compared with the release
                    update: firmware
                        ? {
                            available: updateAvailable,
                            version: firmware,
                            newVersion: updateAvailable ? this.latestFirmware : undefined,
                        }
                        : undefined,
                    hasDetails: true,
                    customInfo: this.buildCustomInfo(device._id, prefix),
                    controls: this.buildControls(shortDeviceId, prefix),
                    actions: [
                        {
                            id: 'rename',
                            icon: 'edit',
                            description: adapter_core_1.I18n.getTranslatedObject('Rename this device'),
                            handler: async (deviceId, context) => await this.handleRenameDevice(deviceId, context),
                        },
                        {
                            id: 'recreate',
                            icon: 'refresh',
                            description: adapter_core_1.I18n.getTranslatedObject('Delete and recreate all data points of this device'),
                            confirmation: adapter_core_1.I18n.getTranslatedObject('This deletes all data points of this device (except its name). They will be recreated automatically the next time the device reports its state. Continue?'),
                            handler: async (deviceId, context) => await this.handleRecreateDevice(deviceId, context),
                        },
                        ...(alive && updateAvailable
                            ? [
                                {
                                    // Also called when the user clicks on the update indicator
                                    id: dm_utils_1.ACTIONS.UPDATE,
                                    icon: 'update',
                                    description: adapter_core_1.I18n.getTranslatedObject('Update firmware'),
                                    confirmation: adapter_core_1.I18n.getTranslatedObject('Update the firmware from %s to %s? The device downloads the firmware from its OTA URL and restarts.', firmware, this.latestFirmware),
                                    // The GUI waits for the answer until the device has restarted
                                    timeout: FIRMWARE_UPDATE_TIMEOUT + 30_000,
                                    handler: async (deviceId, context) => await this.handleFirmwareUpdate(deviceId, context),
                                },
                            ]
                            : []),
                        ...(hostname || ip
                            ? [
                                {
                                    id: 'web',
                                    icon: 'web',
                                    description: adapter_core_1.I18n.getTranslatedObject('Open device web interface'),
                                    url: `http://${hostname || ip}`,
                                },
                            ]
                            : []),
                    ],
                };
                context.addDevice(res);
            }
            catch (error) {
                // One malformed/leftover data point (e.g. a state object without "common", as can happen
                // with data points from a much older adapter version) must not hide every other device
                this.adapter.log.warn(`Cannot load device ${device._id} into the Device Manager: ${error}`);
            }
        }
    }
    async getDeviceDetails(deviceId) {
        // Wait that i18n is initialized
        await this.ready;
        const device = this.objects[deviceId];
        if (device?.type !== 'channel') {
            return null;
        }
        const ns = this.adapter.namespace;
        const shortDeviceId = device._id.substring(ns.length + 1);
        const prefix = `${deviceId}.`;
        const items = {};
        const clientId = device.native?.clientId;
        items._clientId = {
            type: 'staticInfo',
            label: adapter_core_1.I18n.getTranslatedObject('Device ID'),
            data: clientId || shortDeviceId,
            addColon: true,
            copyToClipboard: true,
        };
        const hostname = this.states[`${prefix}INFO.Hostname`]?.val;
        const ip = this.states[`${prefix}INFO.IPAddress`]?.val;
        if (hostname || ip) {
            items._deviceLink = {
                // @ts-expect-error staticLink is OK
                type: 'staticLink',
                href: `http://${hostname || ip}`,
                label: adapter_core_1.I18n.getTranslatedObject('Open device web interface'),
                button: true,
                icon: 'web',
                newLine: true,
            };
        }
        for (const info of INFO_ITEMS) {
            const val = this.states[`${prefix}INFO.${info.stateId}`]?.val;
            if (val === undefined || val === null || val === '') {
                continue;
            }
            items[`info_${info.stateId}`] = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject(info.label),
                data: val,
                addColon: true,
                copyToClipboard: info.copy,
            };
        }
        // The version is reported in two places, see `getFirmwareVersion`
        const firmware = this.getFirmwareVersion(prefix);
        if (firmware) {
            items._firmware = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('Firmware version'),
                data: firmware,
                addColon: true,
            };
            if ((0, firmware_1.isNewerVersion)(this.latestFirmware, firmware)) {
                items._newFirmware = {
                    type: 'staticInfo',
                    label: adapter_core_1.I18n.getTranslatedObject('Available firmware'),
                    data: this.latestFirmware,
                    addColon: true,
                };
            }
        }
        // "Signal" is in dBm, Tasmota's "RSSI" is the link quality in percent (see `buildDeviceStatus`)
        const rssiSuffix = this.findDataPointSuffix(prefix, 'Signal') || this.findDataPointSuffix(prefix, 'RSSI');
        const rssi = rssiSuffix ? this.states[`${prefix}${rssiSuffix}`]?.val : undefined;
        if (typeof rssi === 'number') {
            items._rssi = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('RSSI'),
                data: rssi,
                unit: rssi < 0 ? 'dBm' : '%',
                addColon: true,
            };
        }
        const uptimeSuffix = this.findDataPointSuffix(prefix, 'Uptime');
        const uptime = uptimeSuffix ? this.states[`${prefix}${uptimeSuffix}`]?.val : undefined;
        if (uptime !== undefined && uptime !== null && uptime !== '') {
            items._uptime = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('Uptime'),
                data: uptime,
                addColon: true,
            };
        }
        // Power metering section – only shown when power data points exist. Bridged external meters
        // (SML, PZEM, ...) are shown as their own sub-section when a device has more than one meter.
        const powerEntries = this.getPowerEntries(prefix);
        if (powerEntries.length) {
            items._energyHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Power metering'),
                size: 6,
                newLine: true,
            };
            const channels = [...new Set(powerEntries.map(e => e.channel))];
            const multiChannel = channels.length > 1;
            for (const channel of channels) {
                if (multiChannel && channel) {
                    items[`energy_ch_${channel.replace(/[.:]/g, '_')}`] = {
                        type: 'staticInfo',
                        label: this.channelLabel(channel),
                        data: '',
                        newLine: true,
                    };
                }
                for (const entry of powerEntries.filter(e => e.channel === channel)) {
                    const val = this.states[`${prefix}${entry.suffix}`]?.val;
                    items[`energy_${entry.suffix.replace(/[.:]/g, '_')}`] = {
                        type: 'staticInfo',
                        label: adapter_core_1.I18n.getTranslatedObject(entry.label),
                        data: typeof val === 'number' ? Math.round(val * 100) / 100 : String(val ?? '—'),
                        unit: entry.unit || undefined,
                        addColon: true,
                    };
                }
            }
        }
        // Digital inputs (physical switches/buttons wired to the device)
        const inputEntries = [];
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            // Only the last path segment is the actual data point name (may be nested, e.g. "STATE.Switch1")
            const lastSegment = suffix.substring(suffix.lastIndexOf('.') + 1);
            const match = lastSegment.match(/^(Switch|Button)(\d+)$/);
            if (match) {
                inputEntries.push({ suffix, label: `${match[1]} ${match[2]}` });
            }
        }
        if (inputEntries.length) {
            items._inputsHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Digital inputs'),
                size: 6,
                newLine: true,
            };
            inputEntries.sort((a, b) => a.suffix.localeCompare(b.suffix));
            for (const entry of inputEntries) {
                const val = this.states[`${prefix}${entry.suffix}`]?.val;
                items[`input_${entry.suffix}`] = {
                    type: 'staticInfo',
                    label: entry.label,
                    data: val ? '✓' : '✗',
                    addColon: true,
                };
            }
        }
        return {
            id: deviceId,
            schema: {
                type: 'panel',
                items,
            },
        };
    }
    getDeviceGroup(suffixes) {
        const list = [...suffixes].map(flatName);
        const test = (re) => list.some(s => re.test(s));
        let key = 'other';
        if (test(/^Shutter\d+_Position$/)) {
            key = 'cover';
        }
        else if (test(/^(Color|CT|led_basecolor_rgb|led_basecolor_rgbcw|Dimmer|led_dimmer)$/)) {
            key = 'light';
        }
        else if (test(/^(POWER\d*|led_enableAll)$/)) {
            key = 'relay';
        }
        else if (test(/^(ZbReceived_|ZbPower)/)) {
            key = 'zigbee';
        }
        else if (list.some(s => this.splitPowerSuffix(s) !== undefined)) {
            key = 'meter';
        }
        else if (list.some(s => SENSOR_KEYS.some(k => s === k || s.endsWith(`_${k}`)))) {
            key = 'sensor';
        }
        const meta = groupMeta[key] || groupMeta.other;
        return { key, name: adapter_core_1.I18n.getTranslatedObject(meta.nameKey) };
    }
    buildCustomInfo(deviceId, prefix) {
        const shortDeviceId = deviceId.substring(this.adapter.namespace.length + 1);
        const items = {};
        for (const sensor of SENSOR_ITEMS) {
            const suffix = this.findDataPointSuffix(prefix, sensor.stateId);
            if (suffix !== undefined) {
                items[sensor.stateId] = {
                    type: 'state',
                    oid: `${shortDeviceId}.${suffix}`,
                    control: 'text',
                    unit: sensor.unit,
                    digits: sensor.digits,
                    label: adapter_core_1.I18n.getTranslatedObject(sensor.label),
                    addColon: true,
                    style: { opacity: 0.7 },
                };
            }
        }
        // Power on the main tile: only the actual "Power" (W) readings, never voltage/current/energy
        const powerItems = this.getPowerEntries(prefix).filter(e => e.label === 'Power');
        const multiPower = powerItems.length > 1;
        for (const entry of powerItems) {
            const label = multiPower ? this.channelLabel(entry.channel) : adapter_core_1.I18n.getTranslatedObject('Power');
            items[`power_${entry.suffix.replace(/[.:]/g, '_')}`] = {
                type: 'state',
                oid: `${shortDeviceId}.${entry.suffix}`,
                control: 'text',
                unit: 'W',
                digits: 1,
                label,
                addColon: true,
                style: { opacity: 0.7 },
            };
        }
        if (powerItems.length) {
            items._powerSpacer = {
                type: 'divider',
                color: 'transparent',
                height: 2,
            };
        }
        if (Object.keys(items).length === 0) {
            return undefined;
        }
        return {
            id: deviceId,
            schema: {
                type: 'panel',
                items,
            },
        };
    }
    /**
     * Builds the controls of a device from its writable data points. Every data point is matched by its
     * flattened name (see `flatName`), so the same control shows up with and without the "Create object
     * tree" option. The current values come from the cached states instead of a request per control -
     * the cache holds all states of the adapter anyway (see `init`).
     */
    buildControls(shortDeviceId, prefix) {
        const controls = [];
        const used = new Set();
        const rawStates = [];
        for (const id in this.objects) {
            if (id.startsWith(prefix) && this.objects[id].type === 'state') {
                const suffix = id.substring(prefix.length);
                rawStates.push({
                    id,
                    suffix,
                    name: flatName(suffix),
                    common: this.objects[id].common,
                });
            }
        }
        // Two state objects can flatten to the same name at once - e.g. a bare "POWER" next to a
        // leftover "RESULT.POWER" from before "Create object tree" was toggled. Both would end up as
        // a control with the same ID, which the Device Manager rejects as a duplicate - so only the
        // most recently updated copy of each name is kept (a leftover stops being updated, so its
        // timestamp falls behind, the same fallback rule as `getPowerEntries` uses).
        const byName = new Map();
        for (const state of rawStates) {
            const existing = byName.get(state.name);
            if (!existing || (this.states[state.id]?.ts ?? 0) > (this.states[existing.id]?.ts ?? 0)) {
                byName.set(state.name, state);
            }
        }
        const ownStates = [...byName.values()];
        const stateHandler = (fullId) => async (_deviceId, _actionId, state) => {
            await this.adapter.setForeignStateAsync(fullId, state);
            return { val: state, ts: Date.now(), ack: true };
        };
        const currentState = (fullId) => this.states[fullId] || { val: null, ts: Date.now(), ack: true };
        // A control is named after the data point it belongs to, not after where that data point is
        // stored, so its ID stays the same when "Create object tree" is toggled
        const controlId = (name) => name.replace(/[.:]/g, '_');
        // Primary switches: POWER, POWER1..29, Zigbee bridge relays, OpenBeken LED enable
        const switchRe = /^(POWER\d*|ZbReceived_.+_Power|led_enableAll)$/;
        for (const state of ownStates) {
            if (state.common?.type !== 'boolean' || state.common.write === false || !switchRe.test(state.name)) {
                continue;
            }
            used.add(state.id);
            const label = state.name === 'POWER'
                ? 'Power'
                : state.name.startsWith('POWER')
                    ? `Power ${state.name.substring(5)}`
                    : state.name.replace(/_/g, ' ');
            controls.push({
                id: controlId(state.name),
                type: 'switch',
                stateId: `${shortDeviceId}.${state.suffix}`,
                label: adapter_core_1.I18n.getTranslatedObject(label),
                state: currentState(state.id),
                handler: stateHandler(state.id),
            });
        }
        // Sliders: dimmer, color temperature, shutter position/tilt
        const sliderDefs = [
            { re: /^Dimmer$/, label: () => 'Dimmer', min: 0, max: 100, unit: '%' },
            { re: /^led_dimmer$/, label: () => 'Dimmer', min: 0, max: 100, unit: '%' },
            { re: /^CT$/, label: () => 'Color temperature', min: 153, max: 500 },
            { re: /^led_temperature$/, label: () => 'Color temperature', min: 154, max: 500 },
            { re: /^Shutter(\d+)_Position$/, label: m => `Shutter ${m[1]} position`, min: 0, max: 100, unit: '%' },
            { re: /^Shutter(\d+)_Tilt$/, label: m => `Shutter ${m[1]} tilt`, min: 0, max: 100, unit: '%' },
        ];
        for (const state of ownStates) {
            if (used.has(state.id) || state.common?.type !== 'number' || state.common.write === false) {
                continue;
            }
            for (const def of sliderDefs) {
                const match = state.name.match(def.re);
                if (!match) {
                    continue;
                }
                used.add(state.id);
                controls.push({
                    id: controlId(state.name),
                    type: 'slider',
                    stateId: `${shortDeviceId}.${state.suffix}`,
                    min: state.common.min ?? def.min,
                    max: state.common.max ?? def.max,
                    unit: state.common.unit || def.unit,
                    label: adapter_core_1.I18n.getTranslatedObject(def.label(match)),
                    state: currentState(state.id),
                    handler: stateHandler(state.id),
                });
                break;
            }
        }
        // Color controls
        const colorRe = /^(Color|led_basecolor_rgb|led_basecolor_rgbcw)$/;
        for (const state of ownStates) {
            if (used.has(state.id) ||
                state.common?.type !== 'string' ||
                !state.common.write ||
                !colorRe.test(state.name)) {
                continue;
            }
            used.add(state.id);
            controls.push({
                id: controlId(state.name),
                type: 'color',
                stateId: `${shortDeviceId}.${state.suffix}`,
                label: adapter_core_1.I18n.getTranslatedObject('Color'),
                state: currentState(state.id),
                handler: stateHandler(state.id),
            });
        }
        // Everything else: writable settings not shown elsewhere. INFO/ENERGY/MARGINS are read-only
        // anyway, "Time" is the timestamp of the telemetry message a group of data points came with
        const skipRe = /^(INFO_|ENERGY_|MARGINS_|Wifi_|Time$|alive$)/;
        let group = {
            id: 'group_settings',
            type: 'group',
            label: adapter_core_1.I18n.getTranslatedObject('Settings'),
        };
        // Writable numbers/strings first, then the leftover booleans (toggles like Fade, LED exor
        // mode, ...) as buttons
        for (const pass of ['value', 'button']) {
            for (const state of ownStates) {
                if (used.has(state.id) || skipRe.test(state.name) || !state.common || state.common.write === false) {
                    continue;
                }
                const type = state.common.type;
                if (pass === 'value' ? type !== 'number' && type !== 'string' : type !== 'boolean') {
                    continue;
                }
                used.add(state.id);
                if (group) {
                    controls.push(group);
                    group = null;
                }
                if (pass === 'button') {
                    // A toggle like "Fade" can be switched on and off. A button would only ever send
                    // "true", so it could never switch it off again - only real buttons stay buttons.
                    if (!state.common.role?.startsWith('button')) {
                        controls.push({
                            group: 'group_settings',
                            id: controlId(state.name),
                            type: 'switch',
                            stateId: `${shortDeviceId}.${state.suffix}`,
                            label: state.name.replace(/_/g, ' '),
                            state: currentState(state.id),
                            handler: stateHandler(state.id),
                        });
                        continue;
                    }
                    controls.push({
                        group: 'group_settings',
                        id: controlId(state.name),
                        type: 'button',
                        stateId: `${shortDeviceId}.${state.suffix}`,
                        label: state.name.replace(/_/g, ' '),
                        variant: 'outlined',
                        handler: stateHandler(state.id),
                    });
                    continue;
                }
                let options;
                const commonStates = state.common.states;
                if (commonStates) {
                    options = Array.isArray(commonStates)
                        ? commonStates.map((s) => ({ value: s, label: s }))
                        : Object.keys(commonStates).map(k => ({
                            value: k,
                            label: String(commonStates[k]),
                        }));
                }
                controls.push({
                    group: 'group_settings',
                    id: controlId(state.name),
                    type: options ? 'select' : type === 'number' ? 'number' : 'text',
                    stateId: `${shortDeviceId}.${state.suffix}`,
                    min: state.common.min,
                    max: state.common.max,
                    unit: state.common.unit,
                    options,
                    label: state.name.replace(/_/g, ' '),
                    state: currentState(state.id),
                    handler: stateHandler(state.id),
                });
            }
        }
        return controls;
    }
    /**
     * @param id ID to rename
     * @param context context sent from backend
     */
    async handleRenameDevice(id, context) {
        const result = await context.showForm({
            type: 'panel',
            items: {
                newName: {
                    type: 'text',
                    trim: false,
                    placeholder: '',
                },
            },
        }, {
            data: {
                newName: '',
            },
            title: adapter_core_1.I18n.getTranslatedObject('Enter new name'),
        });
        if (result?.newName === undefined || result?.newName === '') {
            return { refresh: 'none' };
        }
        const obj = {
            common: {
                name: result.newName,
            },
        };
        const res = await this.adapter.extendForeignObjectAsync(id, obj);
        if (res === null) {
            this.adapter.log.warn(`Can not rename device ${id}: ${JSON.stringify(res)}`);
            return { refresh: 'none' };
        }
        return { refresh: 'devices' };
    }
    /**
     * Starts the firmware update of a Tasmota device with "Upgrade 1": the device downloads the firmware
     * from its own OTA URL (by default the official release of its build variant) and restarts. Tasmota
     * does not report the progress, so the dialog follows the restart and waits for the new version, which
     * the device reports after the restart (INFO1, and STATUS2 on request of the adapter).
     *
     * @param id device (channel) ID
     * @param context context to show the progress
     */
    async handleFirmwareUpdate(id, context) {
        const ns = this.adapter.namespace;
        const prefix = `${id}.`;
        const shortDeviceId = id.substring(ns.length + 1);
        const oldVersion = this.getFirmwareVersion(prefix);
        const start = Date.now();
        if (!this.adapter.server?.sendCommand(shortDeviceId, 'Upgrade', '1')) {
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('The device is not connected'));
            return { refresh: 'none' };
        }
        this.adapter.log.info(`Firmware update of ${shortDeviceId} started (installed: ${oldVersion})`);
        const progress = await context.openProgress(adapter_core_1.I18n.getTranslatedObject('Updating firmware...'), {
            indeterminate: true,
            label: adapter_core_1.I18n.getTranslatedObject('The device downloads the firmware...'),
        });
        // "Upgrade" is only stored if objects are created from RESULT, it tells e.g. from where the
        // firmware is downloaded or that the download failed
        let lastMessage = null;
        let restarted = false;
        let result;
        // Every progress update is awaited: the GUI has to confirm one message before the next one is sent
        while (!result) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const upgradeSuffix = this.findDataPointSuffix(prefix, 'Upgrade');
            const upgrade = upgradeSuffix ? this.states[`${prefix}${upgradeSuffix}`] : undefined;
            if (upgrade && upgrade.ts >= start && upgrade.val !== lastMessage) {
                lastMessage = upgrade.val;
                if (/fail|error|abort/i.test(String(upgrade.val))) {
                    result = 'failed';
                    break;
                }
                await progress.update({ label: String(upgrade.val) });
            }
            if (!restarted && this.states[`${prefix}alive`]?.val === false) {
                restarted = true;
                await progress.update({ label: adapter_core_1.I18n.getTranslatedObject('The device restarts...') });
            }
            const version = this.getFirmwareVersion(prefix);
            if (version && version !== oldVersion) {
                result = 'done';
            }
            else if (Date.now() - start > FIRMWARE_UPDATE_TIMEOUT) {
                result = 'timeout';
            }
        }
        await progress.close();
        const newVersion = this.getFirmwareVersion(prefix);
        if (result === 'done') {
            this.adapter.log.info(`Firmware of ${shortDeviceId} updated from ${oldVersion} to ${newVersion}`);
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('The firmware was updated to %s', newVersion));
        }
        else if (result === 'failed') {
            this.adapter.log.warn(`Firmware update of ${shortDeviceId} failed: ${lastMessage}`);
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('The firmware update failed: %s', String(lastMessage)));
        }
        else {
            this.adapter.log.warn(`Firmware update of ${shortDeviceId}: no new version within 5 minutes`);
            await context.showMessage(adapter_core_1.I18n.getTranslatedObject('The device did not report a new firmware within 5 minutes. The update may still be running, please check the device.'));
        }
        return { refresh: 'devices' };
    }
    /**
     * Deletes every data point of a device - its channel object (and therefore a custom name set via
     * `rename`) is kept, everything else gets recreated automatically the next time the device reports
     * its state. This is a manual, user-triggered fix for data points stuck in an outdated structure,
     * e.g. leftovers from before the "Create object tree" adapter option was changed.
     *
     * `alive` is kept as well: it is not reported by the device but written by the adapter when the
     * MQTT client connects (see `createClient` in `mqttBase.ts`), so a deleted `alive` would only come
     * back the next time the device reconnects - which can take days for a device that is simply up.
     *
     * @param id device (channel) ID to recreate
     * @param _context unused - the destructive confirmation is handled declaratively by the action itself
     */
    async handleRecreateDevice(id, _context) {
        const prefix = `${id}.`;
        let removed = 0;
        for (const stateId in this.objects) {
            if (!stateId.startsWith(prefix) || this.objects[stateId].type !== 'state') {
                continue;
            }
            if (stateId === `${prefix}alive`) {
                continue;
            }
            try {
                await this.adapter.delForeignStateAsync(stateId);
                await this.adapter.delForeignObjectAsync(stateId);
                delete this.objects[stateId];
                delete this.states[stateId];
                removed++;
            }
            catch (error) {
                this.adapter.log.warn(`Cannot remove data point ${stateId}: ${error}`);
            }
        }
        // The server/bridge remembers which objects it has already created and would not create them a
        // second time within this adapter run, so the deleted data points have to be forgotten there
        // too - otherwise they only come back after a restart of the adapter
        this.adapter.server?.forgetObjects(id);
        this.adapter.log.info(`Removed ${removed} data point(s) of ${id}, they will be recreated automatically`);
        return { refresh: 'devices' };
    }
}
exports.default = SonoffDeviceManagement;
//# sourceMappingURL=deviceManager.js.map