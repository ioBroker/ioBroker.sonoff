import { I18n, type AdapterInstance } from '@iobroker/adapter-core';
import {
    DeviceManagement,
    type ActionContext,
    type ConfigItemAny,
    type DeviceControl,
    type DeviceDetails,
    type DeviceInfo,
    type DeviceLoadContext,
    type DeviceRefresh,
    type InstanceDetails,
} from '@iobroker/dm-utils';
// It must be exported to index in dm-utils
import type { ControlState } from '@iobroker/dm-utils/build/types/base';

/** Icon shown for every device, since the adapter does not ship per-model icons */
const DEVICE_ICON = 'adapter/sonoff/admin/sonoff.png';

/** Group metadata: display name key (for i18n) */
const groupMeta: Record<string, { nameKey: string }> = {
    relay: { nameKey: 'Relays & Switches' },
    light: { nameKey: 'Lights & Dimmers' },
    cover: { nameKey: 'Shutters & Covers' },
    zigbee: { nameKey: 'Zigbee bridges' },
    meter: { nameKey: 'Energy Meters' },
    sensor: { nameKey: 'Sensors' },
    other: { nameKey: 'Other' },
};

/** Well-known sensor data points shown on the main tile */
const SENSOR_ITEMS: { stateId: string; label: string; unit: string; digits?: number }[] = [
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
const POWER_METRIC_LABELS: Record<string, { label: string; unit: string; order: number }> = {
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
const INFO_ITEMS: { stateId: string; label: string; copy?: boolean }[] = [
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
export default class SonoffDeviceManagement extends DeviceManagement {
    private readonly ready: Promise<void>;
    private readonly states: { [id: string]: ioBroker.State } = {};
    private readonly objects: { [id: string]: ioBroker.ChannelObject | ioBroker.StateObject } = {};

    constructor(adapter: AdapterInstance) {
        super(adapter);

        // Initialize i18n
        this.ready = I18n.init(__dirname, adapter)
            .catch(error => this.adapter.log.error(`Cannot initialize i18n: ${error}`))
            .then(() => this.init());
    }

    private async init(): Promise<void> {
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

    protected getInstanceInfo(): InstanceDetails {
        return {
            apiVersion: 'v3',
            smallCards: true,
        };
    }

    public onStateChange(id: string, state: ioBroker.State | null): void {
        if (state) {
            if (!this.states[id] || this.states[id].val !== state.val) {
                // trigger DM update
                this.states[id] = state;
            }
        } else if (this.states[id]) {
            // trigger DM update
            delete this.states[id];
        }
    }

    public onObjectChange(id: string, obj: ioBroker.ChannelObject | ioBroker.StateObject | null): void {
        if (obj) {
            this.objects[id] = obj;
        } else {
            delete this.objects[id];
        }
    }

    /**
     * Collects the short suffixes (state ID without the device prefix) of all currently known
     * objects that belong to one device, e.g. "POWER1", "ENERGY.Voltage" or "Shutter1_Position".
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    private getSuffixes(prefix: string): Set<string> {
        const suffixes = new Set<string>();
        for (const id in this.objects) {
            if (id.startsWith(prefix)) {
                suffixes.add(id.substring(prefix.length));
            }
        }
        return suffixes;
    }

    /**
     * Splits a state suffix into the group it belongs to and the data point name, e.g.
     * "ENERGY.Voltage" -> { channel: "ENERGY", key: "Voltage" } and "SML_Total_in" (a bridged external
     * meter nested under a custom "SML" group) -> { channel: "SML", key: "Total_in" }. A bare data point
     * without any group, e.g. "Voltage", resolves to `{ channel: "", key: "Voltage" }`.
     *
     * @param suffix state ID without the device prefix
     */
    private splitPowerSuffix(suffix: string): { channel: string; key: string } | undefined {
        const dotIdx = suffix.indexOf('.');
        if (dotIdx > -1) {
            const key = suffix.substring(dotIdx + 1);
            return POWER_METRIC_LABELS[key] ? { channel: suffix.substring(0, dotIdx), key } : undefined;
        }
        if (POWER_METRIC_LABELS[suffix]) {
            return { channel: '', key: suffix };
        }
        for (const key of Object.keys(POWER_METRIC_LABELS)) {
            if (suffix.endsWith(`_${key}`)) {
                return { channel: suffix.substring(0, suffix.length - key.length - 1), key };
            }
        }
        return undefined;
    }

    /**
     * Finds all power-metering data points of a device, wherever they are: in the built-in `ENERGY.*`
     * group, in a custom group of a bridged external meter, or as a bare top-level data point.
     *
     * @param prefix `<namespace>.<deviceId>.`
     */
    private getPowerEntries(
        prefix: string,
    ): { suffix: string; channel: string; key: string; label: string; unit: string; order: number }[] {
        const entries: { suffix: string; channel: string; key: string; label: string; unit: string; order: number }[] =
            [];
        for (const stateId of Object.keys(this.states)) {
            if (!stateId.startsWith(prefix)) {
                continue;
            }
            const suffix = stateId.substring(prefix.length);
            const common = (this.objects[stateId] as ioBroker.StateObject | undefined)?.common;
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
        return entries.sort((a, b) => a.channel.localeCompare(b.channel) || a.order - b.order);
    }

    /**
     * Load all sonoff/Tasmota devices
     *
     * @param context context used to report the found devices to the backend
     */
    async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
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
            const hostname = this.states[`${prefix}INFO.Hostname`]?.val as string | undefined;
            const ip = this.states[`${prefix}INFO.IPAddress`]?.val as string | undefined;
            const model = (this.states[`${prefix}INFO.Module`]?.val as string) || undefined;
            const rssi = this.states[`${prefix}Wifi_RSSI`]?.val as number | undefined;
            const battery = this.states[`${prefix}BatteryPercentage`]?.val as number | undefined;
            const clientId = (device.native as { clientId?: string } | undefined)?.clientId;
            const group = this.getDeviceGroup(suffixes);

            const res: DeviceInfo<string> = {
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
                        description: I18n.getTranslatedObject('Rename this device'),
                        handler: async (
                            deviceId: string,
                            context: ActionContext,
                        ): Promise<{ refresh: DeviceRefresh }> => await this.handleRenameDevice(deviceId, context),
                    },
                    ...(hostname || ip
                        ? [
                              {
                                  id: 'web',
                                  icon: 'web' as const,
                                  description: I18n.getTranslatedObject('Open device web interface'),
                                  url: `http://${hostname || ip}`,
                              },
                          ]
                        : []),
                ],
            };

            context.addDevice(res);
        }
    }

    getDeviceDetails(deviceId: string): DeviceDetails<string> | null {
        const device = this.objects[deviceId];
        if (device?.type !== 'channel') {
            return null;
        }

        const ns = this.adapter.namespace;
        const shortDeviceId = device._id.substring(ns.length + 1);
        const prefix = `${deviceId}.`;
        const items: Record<string, ConfigItemAny> = {};

        const clientId = (device.native as { clientId?: string } | undefined)?.clientId;
        items._clientId = {
            type: 'staticInfo',
            label: I18n.getTranslatedObject('Device ID'),
            data: clientId || shortDeviceId,
            addColon: true,
            copyToClipboard: true,
        };

        const hostname = this.states[`${prefix}INFO.Hostname`]?.val as string | undefined;
        const ip = this.states[`${prefix}INFO.IPAddress`]?.val as string | undefined;
        if (hostname || ip) {
            items._deviceLink = {
                // @ts-expect-error staticLink is OK
                type: 'staticLink',
                href: `http://${hostname || ip}`,
                label: I18n.getTranslatedObject('Open device web interface'),
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
                label: I18n.getTranslatedObject(info.label),
                data: val,
                addColon: true,
                copyToClipboard: info.copy,
            };
        }

        const rssi = this.states[`${prefix}Wifi_RSSI`]?.val as number | undefined;
        if (rssi !== undefined) {
            items._rssi = {
                type: 'staticInfo',
                label: I18n.getTranslatedObject('RSSI'),
                data: rssi,
                unit: 'dBm',
                addColon: true,
            };
        }

        const uptime = this.states[`${prefix}Uptime`]?.val;
        if (uptime !== undefined && uptime !== null && uptime !== '') {
            items._uptime = {
                type: 'staticInfo',
                label: I18n.getTranslatedObject('Uptime'),
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
                text: I18n.getTranslatedObject('Power metering'),
                size: 4,
                newLine: true,
            };

            const channels = [...new Set(powerEntries.map(e => e.channel))];
            const multiChannel = channels.length > 1;

            for (const channel of channels) {
                if (multiChannel && channel) {
                    items[`energy_ch_${channel}`] = {
                        type: 'staticInfo',
                        label: channel.replace(/_/g, ' '),
                        data: '',
                        newLine: true,
                    };
                }
                for (const entry of powerEntries.filter(e => e.channel === channel)) {
                    const val = this.states[`${prefix}${entry.suffix}`]?.val;
                    items[`energy_${entry.suffix.replace(/[.:]/g, '_')}`] = {
                        type: 'staticInfo',
                        label: I18n.getTranslatedObject(entry.label),
                        data: typeof val === 'number' ? Math.round(val * 100) / 100 : String(val ?? '—'),
                        unit: entry.unit || undefined,
                        addColon: true,
                    };
                }
            }
        }

        // Digital inputs (physical switches/buttons wired to the device)
        const inputEntries: { suffix: string; label: string }[] = [];
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
                text: I18n.getTranslatedObject('Digital inputs'),
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

    private getDeviceGroup(suffixes: Set<string>): { key: string; name: ioBroker.StringOrTranslated } {
        const list = [...suffixes];
        const test = (re: RegExp): boolean => list.some(s => re.test(s));

        let key = 'other';
        if (test(/^Shutter\d+_Position$/)) {
            key = 'cover';
        } else if (test(/^(Color|CT|led_basecolor_rgb|led_basecolor_rgbcw|Dimmer|led_dimmer)$/)) {
            key = 'light';
        } else if (test(/^(POWER\d*|led_enableAll)$/)) {
            key = 'relay';
        } else if (test(/^(ZbReceived_|ZbPower)/)) {
            key = 'zigbee';
        } else if (list.some(s => this.splitPowerSuffix(s) !== undefined)) {
            key = 'meter';
        } else if (
            test(
                /^(Temperature|Humidity|Pressure|Illuminance|CarbonDioxide|TVOC|eCO2|DewPoint|AirQuality|PM2\.5|PM10|UvIndex|Distance|Noise)/,
            )
        ) {
            key = 'sensor';
        }

        const meta = groupMeta[key] || groupMeta.other;
        return { key, name: I18n.getTranslatedObject(meta.nameKey) };
    }

    private buildCustomInfo(deviceId: string, prefix: string): DeviceDetails<string> | undefined {
        const shortDeviceId = deviceId.substring(this.adapter.namespace.length + 1);
        const items: Record<string, ConfigItemAny> = {};

        for (const sensor of SENSOR_ITEMS) {
            if (this.states[`${prefix}${sensor.stateId}`] !== undefined) {
                items[sensor.stateId] = {
                    type: 'state',
                    oid: `${shortDeviceId}.${sensor.stateId}`,
                    control: 'text',
                    unit: sensor.unit,
                    digits: sensor.digits,
                    label: I18n.getTranslatedObject(sensor.label),
                    size: 12,
                    style: { opacity: 0.7 },
                };
            }
        }

        // Power on the main tile: only the actual "Power" (W) readings, never voltage/current/energy
        const powerItems = this.getPowerEntries(prefix).filter(e => e.label === 'Power');
        const multiPower = powerItems.length > 1;
        for (const entry of powerItems) {
            const label = multiPower
                ? (entry.channel.replace(/_/g, ' ') as ioBroker.StringOrTranslated)
                : I18n.getTranslatedObject('Power');
            items[`power_${entry.suffix.replace(/[.:]/g, '_')}`] = {
                type: 'state',
                oid: `${shortDeviceId}.${entry.suffix}`,
                control: 'text',
                unit: 'W',
                digits: 1,
                label,
                addColon: true,
                style: { fontWeight: 'bold' },
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

    private async buildControls(shortDeviceId: string, prefix: string): Promise<DeviceControl<string>[]> {
        const controls: DeviceControl<string>[] = [];
        const usedIds: string[] = [];
        const ownStates: string[] = [];

        for (const id in this.objects) {
            if (id.startsWith(prefix) && this.objects[id].type === 'state') {
                ownStates.push(id);
            }
        }

        const stateHandler =
            (fullId: string) =>
            async (_deviceId: string, _actionId: string, state: ControlState): Promise<ioBroker.State> => {
                await this.adapter.setForeignStateAsync(fullId, state);
                return { val: state, ts: Date.now(), ack: true } as ioBroker.State;
            };

        const currentState = async (fullId: string): Promise<ioBroker.State> =>
            (await this.adapter.getForeignStateAsync(fullId)) ||
            ({ val: null, ts: Date.now(), ack: true } as ioBroker.State);

        // Primary switches: POWER, POWER1..29, Zigbee bridge relays, OpenBeken LED enable
        const switchRe = /^(POWER\d*|ZbReceived_.+_Power|led_enableAll)$/;
        for (const id of ownStates) {
            const suffix = id.substring(prefix.length);
            const common = this.objects[id].common as ioBroker.StateCommon;
            if (common?.type !== 'boolean' || common.write === false || !switchRe.test(suffix)) {
                continue;
            }
            usedIds.push(id);
            const label =
                suffix === 'POWER'
                    ? 'Power'
                    : suffix.startsWith('POWER')
                      ? `Power ${suffix.substring(5)}`
                      : suffix.replace(/_/g, ' ');
            controls.push({
                id: suffix.replace(/\./g, '_'),
                type: 'switch',
                stateId: `${shortDeviceId}.${suffix}`,
                label: I18n.getTranslatedObject(label),
                state: await currentState(id),
                handler: stateHandler(id),
            });
        }

        // Sliders: dimmer, color temperature, shutter position/tilt
        const sliderDefs: {
            re: RegExp;
            label: (m: RegExpMatchArray) => string;
            min: number;
            max: number;
            unit?: string;
        }[] = [
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
            const common = this.objects[id].common as ioBroker.StateCommon;
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
                    label: I18n.getTranslatedObject(def.label(match)),
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
            const common = this.objects[id].common as ioBroker.StateCommon;
            if (common?.type !== 'string' || !common.write || !colorRe.test(suffix)) {
                continue;
            }
            usedIds.push(id);
            controls.push({
                id: suffix,
                type: 'color',
                stateId: `${shortDeviceId}.${suffix}`,
                label: I18n.getTranslatedObject('Color'),
                state: await currentState(id),
                handler: stateHandler(id),
            });
        }

        // Everything else: writable settings not shown elsewhere (INFO/ENERGY/MARGINS are read-only anyway)
        const skipRe = /^(INFO\.|ENERGY\.|MARGINS\.|Wifi_|alive$)/;
        let group: DeviceControl<string> | null = {
            id: 'group_settings',
            type: 'group',
            label: I18n.getTranslatedObject('Settings'),
        };

        for (const id of ownStates) {
            if (usedIds.includes(id)) {
                continue;
            }
            const suffix = id.substring(prefix.length);
            if (skipRe.test(suffix)) {
                continue;
            }
            const common = this.objects[id].common as ioBroker.StateCommon;
            if (common?.write === false || (common.type !== 'number' && common.type !== 'string')) {
                continue;
            }
            usedIds.push(id);

            let options: { label: string; value: string }[] | undefined;
            if (common.states) {
                options = [];
                if (Array.isArray(common.states)) {
                    common.states.forEach((s: string) => options!.push({ value: s, label: s }));
                } else {
                    Object.keys(common.states).forEach(k =>
                        options!.push({ value: k, label: String((common.states as Record<string, string>)[k]) }),
                    );
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
            const common = this.objects[id].common as ioBroker.StateCommon;
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
    async handleRenameDevice(id: string, context: ActionContext): Promise<{ refresh: DeviceRefresh }> {
        const result = await context.showForm(
            {
                type: 'panel',
                items: {
                    newName: {
                        type: 'text',
                        trim: false,
                        placeholder: '',
                    },
                },
            },
            {
                data: {
                    newName: '',
                },
                title: I18n.getTranslatedObject('Enter new name'),
            },
        );
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
        return { refresh: 'device' as DeviceRefresh };
    }
}
