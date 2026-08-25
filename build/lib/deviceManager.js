"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_core_1 = require("@iobroker/adapter-core");
const dm_utils_1 = require("@iobroker/dm-utils");
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
/** Data points forming the energy metering section of the details panel */
const ENERGY_ITEMS = [
    { stateId: 'Voltage', label: 'Voltage', unit: 'V' },
    { stateId: 'Current', label: 'Current', unit: 'A' },
    { stateId: 'Power', label: 'Power', unit: 'W' },
    { stateId: 'ApparentPower', label: 'Apparent power', unit: 'VA' },
    { stateId: 'ReactivePower', label: 'Reactive power', unit: 'var' },
    { stateId: 'Factor', label: 'Power factor', unit: '' },
    { stateId: 'Frequency', label: 'Frequency', unit: 'Hz' },
    { stateId: 'Today', label: 'Today', unit: 'kWh' },
    { stateId: 'Yesterday', label: 'Yesterday', unit: 'kWh' },
    { stateId: 'Total', label: 'Total', unit: 'kWh' },
];
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
 * DeviceManager Class
 */
class SonoffDeviceManagement extends dm_utils_1.DeviceManagement {
    ready;
    states = {};
    objects = {};
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
            const rssi = this.states[`${prefix}Wifi_RSSI`]?.val;
            const battery = this.states[`${prefix}BatteryPercentage`]?.val;
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
                model: model || adapter_core_1.I18n.getTranslatedObject('Tasmota device'),
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
        const rssi = this.states[`${prefix}Wifi_RSSI`]?.val;
        if (rssi !== undefined) {
            items._rssi = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('RSSI'),
                data: rssi,
                unit: 'dBm',
                addColon: true,
            };
        }
        const uptime = this.states[`${prefix}Uptime`]?.val;
        if (uptime !== undefined && uptime !== null && uptime !== '') {
            items._uptime = {
                type: 'staticInfo',
                label: adapter_core_1.I18n.getTranslatedObject('Uptime'),
                data: uptime,
                addColon: true,
            };
        }
        // Energy metering section – only shown when energy data points exist
        const energyEntries = ENERGY_ITEMS.filter(e => this.states[`${prefix}ENERGY.${e.stateId}`] !== undefined);
        if (energyEntries.length) {
            items._energyHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Power metering'),
                size: 4,
                newLine: true,
            };
            for (const entry of energyEntries) {
                const val = this.states[`${prefix}ENERGY.${entry.stateId}`]?.val;
                items[`energy_${entry.stateId}`] = {
                    type: 'staticInfo',
                    label: adapter_core_1.I18n.getTranslatedObject(entry.label),
                    data: typeof val === 'number' ? Math.round(val * 100) / 100 : String(val ?? '—'),
                    unit: entry.unit || undefined,
                    addColon: true,
                };
            }
        }
        // Digital inputs (physical switches/buttons wired to the device)
        const inputEntries = [];
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            const match = suffix.match(/^(Switch|Button)(\d+)$/);
            if (match) {
                inputEntries.push({ suffix, label: `${match[1]} ${match[2]}` });
            }
        }
        if (inputEntries.length) {
            items._inputsHeader = {
                type: 'header',
                text: adapter_core_1.I18n.getTranslatedObject('Digital inputs'),
                size: 4,
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
        else if (test(/^ENERGY\./)) {
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
            if (this.states[`${prefix}${sensor.stateId}`] !== undefined) {
                items[sensor.stateId] = {
                    type: 'state',
                    oid: `${shortDeviceId}.${sensor.stateId}`,
                    control: 'text',
                    unit: sensor.unit,
                    digits: sensor.digits,
                    label: adapter_core_1.I18n.getTranslatedObject(sensor.label),
                    size: 12,
                    style: { opacity: 0.7 },
                };
            }
        }
        if (this.states[`${prefix}ENERGY.Power`] !== undefined) {
            items._power = {
                type: 'state',
                oid: `${shortDeviceId}.ENERGY.Power`,
                control: 'text',
                unit: 'W',
                digits: 1,
                label: adapter_core_1.I18n.getTranslatedObject('Power'),
                addColon: true,
                style: { fontWeight: 'bold' },
            };
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