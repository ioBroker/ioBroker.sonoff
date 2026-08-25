"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const dm_utils_1 = require("@iobroker/dm-utils");
/** How often the periodic cleanup of superseded data points runs, see `cleanupObsoleteDataPoints` */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
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
    Period: { label: 'Period', unit: 'W', order: 13 },
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
    { stateId: 'Version', label: 'Firmware version' },
    { stateId: 'Hardware', label: 'Hardware' },
    { stateId: 'BuildDateTime', label: 'Build date' },
    { stateId: 'Core', label: 'Core' },
    { stateId: 'SDK', label: 'SDK' },
];
/**
 * Data points that are cheap to identify by a fixed name (the keys of `POWER_METRIC_LABELS` plus a
 * few well-known status values) and therefore candidates for the "superseded duplicate" cleanup in
 * `cleanupObsoleteDataPoints` - not just the power-metering ones, since RSSI, Uptime and the sensor
 * readouts move around the object tree the exact same way when "Create object tree" is toggled.
 */
const CLEANUP_KEYS = [
    ...Object.keys(POWER_METRIC_LABELS),
    'RSSI',
    'Uptime',
    'BatteryPercentage',
    ...SENSOR_ITEMS.map(s => s.stateId),
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
/** Whether a (raw, non-canonicalized) channel was created under the "Create object tree" naming. */
function isObjTreeStyleChannel(channel) {
    return /^(SENSOR|STATE|RESULT|WAKEUP)\./.test(channel);
}
/**
 * DeviceManager Class
 */
class SonoffDeviceManagement extends dm_utils_1.DeviceManagement {
    ready;
    states = {};
    objects = {};
    cleanupTimer = null;
    constructor(adapter) {
        super(adapter);
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
        await this.cleanupObsoleteDataPoints().catch(error => this.adapter.log.warn(`Cannot clean up obsolete data points: ${error}`));
        this.cleanupTimer = setInterval(() => {
            this.cleanupObsoleteDataPoints().catch(error => this.adapter.log.warn(`Cannot clean up obsolete data points: ${error}`));
        }, CLEANUP_INTERVAL_MS);
    }
    /** Stops the periodic cleanup timer. Must be called from the adapter's `unload` handler. */
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Toggling the "Create object tree" (OBJ_TREE) adapter option changes the state ID a data point is
     * created under (see `splitDataPoint`), e.g. RSSI moves from "Wifi_RSSI" to "STATE.Wifi.RSSI". The
     * old state is never deleted by the MQTT handling itself, so it keeps existing side by side with the
     * new one - showing every such value twice (most noticeably power metering, where every match is
     * listed). This removes the leftover: for every data point that exists more than once for the same
     * device and meter, the copy(s) that don't match the *current* OBJ_TREE setting are deleted, but only
     * once a copy that does match already exists - so nothing is ever deleted before its replacement is
     * confirmed to be there.
     */
    async cleanupObsoleteDataPoints() {
        const ns = this.adapter.namespace;
        const objTreeEnabled = !!this.adapter.config.OBJ_TREE;
        let removed = 0;
        for (const deviceId in this.objects) {
            const device = this.objects[deviceId];
            if (device.type !== 'channel') {
                continue;
            }
            const shortDeviceId = device._id.substring(ns.length + 1);
            if (!shortDeviceId || shortDeviceId.includes('.') || shortDeviceId === 'info') {
                continue;
            }
            const prefix = `${device._id}.`;
            const byDataPoint = new Map();
            for (const id in this.objects) {
                if (!id.startsWith(prefix) || this.objects[id].type !== 'state') {
                    continue;
                }
                const suffix = id.substring(prefix.length);
                const split = splitDataPoint(suffix, CLEANUP_KEYS);
                if (!split) {
                    continue;
                }
                const groupKey = `${canonicalizeChannel(split.channel)} ${split.key}`;
                const group = byDataPoint.get(groupKey);
                if (group) {
                    group.push(suffix);
                }
                else {
                    byDataPoint.set(groupKey, [suffix]);
                }
            }
            for (const suffixes of byDataPoint.values()) {
                if (suffixes.length < 2) {
                    continue;
                }
                const isCurrent = (suffix) => isObjTreeStyleChannel(splitDataPoint(suffix, CLEANUP_KEYS).channel) === objTreeEnabled;
                if (!suffixes.some(isCurrent)) {
                    // None of the duplicates match the current setting yet (the device hasn't reported
                    // under the new scheme since the option was changed) - keep everything for now.
                    continue;
                }
                for (const suffix of suffixes) {
                    if (isCurrent(suffix)) {
                        continue;
                    }
                    const id = `${prefix}${suffix}`;
                    try {
                        await this.adapter.delForeignStateAsync(id);
                        await this.adapter.delForeignObjectAsync(id);
                        removed++;
                    }
                    catch (error) {
                        this.adapter.log.warn(`Cannot remove obsolete data point ${id}: ${error}`);
                    }
                }
            }
        }
        if (removed) {
            this.adapter.log.info(`Removed ${removed} data point(s) superseded by the current "Create object tree" setting`);
        }
    }
    getInstanceInfo() {
        return {
            apiVersion: 'v3',
            smallCards: true,
        };
    }
    onStateChange(id, state) {
        if (state) {
            if (!this.states[id] || this.states[id].val !== state.val) {
                // trigger DM update
                this.states[id] = state;
            }
        }
        else if (this.states[id]) {
            // trigger DM update
            delete this.states[id];
        }
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
     * @param prefix `<namespace>.<deviceId>.`
     * @param key data point name, e.g. "RSSI" or "Temperature"
     */
    findDataPointSuffix(prefix, key) {
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            if (suffix === key || suffix.endsWith(`.${key}`) || suffix.endsWith(`_${key}`)) {
                return suffix;
            }
        }
        return undefined;
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
        if (channel === 'ENERGY' || channel === 'MARGINS') {
            return adapter_core_1.I18n.getTranslatedObject('Power');
        }
        return channel.replace(/[._]/g, ' ');
    }
    /**
     * Finds all power-metering data points of a device, wherever they are: in the built-in `ENERGY.*`
     * group, in a custom group of a bridged external meter, or as a bare top-level data point.
     *
     * Toggling the "Create object tree" option changes the state IDs data points are created under
     * (see `splitPowerSuffix`), and old states are never removed - so a leftover, no-longer-updated
     * state from before the option was changed can exist next to the live one for the very same meter
     * and metric. Guessing which of the two is "the current one" from the adapter's OBJ_TREE setting
     * alone turned out unreliable (Tasmota can report the same value under more than one data point
     * name, e.g. a German-named alias, independently of OBJ_TREE). Instead, only the entry whose state
     * was updated most recently is kept per meter and metric (channel + label) - the leftover state
     * simply stops receiving updates once its topic is no longer published, so its timestamp falls
     * behind.
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
            const preferred = group.reduce((newest, entry) => {
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
            const prefix = `${device._id}.`;
            const suffixes = this.getSuffixes(prefix);
            const alive = this.states[`${device._id}.alive`]?.val === true;
            const hostname = this.states[`${prefix}INFO.Hostname`]?.val;
            const ip = this.states[`${prefix}INFO.IPAddress`]?.val;
            const model = this.states[`${prefix}INFO.Module`]?.val || undefined;
            const rssiSuffix = this.findDataPointSuffix(prefix, 'RSSI');
            const rssi = rssiSuffix ? this.states[`${prefix}${rssiSuffix}`]?.val : undefined;
            const batterySuffix = this.findDataPointSuffix(prefix, 'BatteryPercentage');
            const battery = batterySuffix
                ? this.states[`${prefix}${batterySuffix}`]?.val
                : undefined;
            const clientId = device.native?.clientId;
            const group = this.getDeviceGroup(suffixes);
            const res = {
                id: device._id,
                identifier: hostname || ip || clientId || undefined,
                name: device.common.name,
                icon: DEVICE_ICON,
                color: !alive ? '#fff' : undefined,
                backgroundColor: !alive ? '#f44336' : undefined,
                group,
                model,
                status: {
                    connection: alive ? 'connected' : 'disconnected',
                    rssi,
                    battery,
                },
                hasDetails: true,
                customInfo: this.buildCustomInfo(device._id, prefix),
                controls: await this.buildControls(shortDeviceId, prefix),
                actions: [
                    {
                        id: 'rename',
                        icon: 'edit',
                        description: adapter_core_1.I18n.getTranslatedObject('Rename this device'),
                        handler: async (deviceId, context) => await this.handleRenameDevice(deviceId, context),
                    },
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
    }
    getDeviceDetails(deviceId) {
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
        const rssiSuffix = this.findDataPointSuffix(prefix, 'RSSI');
        const rssi = rssiSuffix ? this.states[`${prefix}${rssiSuffix}`]?.val : undefined;
        if (rssi !== undefined) {
            items._rssi = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('RSSI'),
                data: rssi,
                unit: 'dBm',
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
        const list = [...suffixes];
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
        else if (test(/^(Temperature|Humidity|Pressure|Illuminance|CarbonDioxide|TVOC|eCO2|DewPoint|AirQuality|PM2\.5|PM10|UvIndex|Distance|Noise)/)) {
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
    async buildControls(shortDeviceId, prefix) {
        const controls = [];
        const usedIds = [];
        const ownStates = [];
        for (const id in this.objects) {
            if (id.startsWith(prefix) && this.objects[id].type === 'state') {
                ownStates.push(id);
            }
        }
        const stateHandler = (fullId) => async (_deviceId, _actionId, state) => {
            await this.adapter.setForeignStateAsync(fullId, state);
            return { val: state, ts: Date.now(), ack: true };
        };
        const currentState = async (fullId) => (await this.adapter.getForeignStateAsync(fullId)) ||
            { val: null, ts: Date.now(), ack: true };
        // Primary switches: POWER, POWER1..29, Zigbee bridge relays, OpenBeken LED enable
        const switchRe = /^(POWER\d*|ZbReceived_.+_Power|led_enableAll)$/;
        for (const id of ownStates) {
            const suffix = id.substring(prefix.length);
            const common = this.objects[id].common;
            if (common?.type !== 'boolean' || common.write === false || !switchRe.test(suffix)) {
                continue;
            }
            usedIds.push(id);
            const label = suffix === 'POWER'
                ? 'Power'
                : suffix.startsWith('POWER')
                    ? `Power ${suffix.substring(5)}`
                    : suffix.replace(/_/g, ' ');
            controls.push({
                id: suffix.replace(/\./g, '_'),
                type: 'switch',
                stateId: `${shortDeviceId}.${suffix}`,
                label: adapter_core_1.I18n.getTranslatedObject(label),
                state: await currentState(id),
                handler: stateHandler(id),
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
        for (const id of ownStates) {
            if (usedIds.includes(id)) {
                continue;
            }
            const suffix = id.substring(prefix.length);
            const common = this.objects[id].common;
            if (common?.type !== 'number' || common.write === false) {
                continue;
            }
            for (const def of sliderDefs) {
                const match = suffix.match(def.re);
                if (!match) {
                    continue;
                }
                usedIds.push(id);
                controls.push({
                    id: suffix.replace(/\./g, '_'),
                    type: 'slider',
                    stateId: `${shortDeviceId}.${suffix}`,
                    min: common.min ?? def.min,
                    max: common.max ?? def.max,
                    unit: common.unit || def.unit,
                    label: adapter_core_1.I18n.getTranslatedObject(def.label(match)),
                    state: await currentState(id),
                    handler: stateHandler(id),
                });
                break;
            }
        }
        // Color controls
        const colorRe = /^(Color|led_basecolor_rgb|led_basecolor_rgbcw)$/;
        for (const id of ownStates) {
            if (usedIds.includes(id)) {
                continue;
            }
            const suffix = id.substring(prefix.length);
            const common = this.objects[id].common;
            if (common?.type !== 'string' || !common.write || !colorRe.test(suffix)) {
                continue;
            }
            usedIds.push(id);
            controls.push({
                id: suffix,
                type: 'color',
                stateId: `${shortDeviceId}.${suffix}`,
                label: adapter_core_1.I18n.getTranslatedObject('Color'),
                state: await currentState(id),
                handler: stateHandler(id),
            });
        }
        // Everything else: writable settings not shown elsewhere (INFO/ENERGY/MARGINS are read-only anyway)
        const skipRe = /^(INFO\.|ENERGY\.|MARGINS\.|Wifi_|alive$)/;
        let group = {
            id: 'group_settings',
            type: 'group',
            label: adapter_core_1.I18n.getTranslatedObject('Settings'),
        };
        for (const id of ownStates) {
            if (usedIds.includes(id)) {
                continue;
            }
            const suffix = id.substring(prefix.length);
            if (skipRe.test(suffix)) {
                continue;
            }
            const common = this.objects[id].common;
            if (common?.write === false || (common.type !== 'number' && common.type !== 'string')) {
                continue;
            }
            usedIds.push(id);
            let options;
            if (common.states) {
                options = [];
                if (Array.isArray(common.states)) {
                    common.states.forEach((s) => options.push({ value: s, label: s }));
                }
                else {
                    Object.keys(common.states).forEach(k => options.push({ value: k, label: String(common.states[k]) }));
                }
            }
            if (group) {
                controls.push(group);
                group = null;
            }
            controls.push({
                group: 'group_settings',
                id: suffix.replace(/\./g, '_'),
                type: options ? 'select' : common.type === 'number' ? 'number' : 'text',
                stateId: `${shortDeviceId}.${suffix}`,
                min: common.min,
                max: common.max,
                unit: common.unit,
                options,
                label: suffix.replace(/_/g, ' '),
                state: await currentState(id),
                handler: stateHandler(id),
            });
        }
        // Leftover writable booleans (toggles like Fade, LED exor mode, ...) as buttons
        for (const id of ownStates) {
            if (usedIds.includes(id)) {
                continue;
            }
            const suffix = id.substring(prefix.length);
            if (skipRe.test(suffix)) {
                continue;
            }
            const common = this.objects[id].common;
            if (common?.write === false || common.type !== 'boolean') {
                continue;
            }
            usedIds.push(id);
            if (group) {
                controls.push(group);
                group = null;
            }
            controls.push({
                group: 'group_settings',
                id: suffix.replace(/\./g, '_'),
                type: 'button',
                stateId: `${shortDeviceId}.${suffix}`,
                label: suffix.replace(/_/g, ' '),
                variant: 'outlined',
                handler: stateHandler(id),
            });
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
        return { refresh: 'device' };
    }
}
exports.default = SonoffDeviceManagement;
//# sourceMappingURL=deviceManager.js.map