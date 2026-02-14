"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonoffAdapter = void 0;
/**
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017-2026 bluefox
 *
 *      MIT License
 */
const adapter_core_1 = require("@iobroker/adapter-core");
const server_1 = __importDefault(require("./lib/server"));
const client_1 = __importDefault(require("./lib/client"));
const datapoints_1 = __importDefault(require("./lib/datapoints"));
const FORBIDDEN_CHARS = /[\]\\[*,;'"`<>\\?]/g;
class SonoffAdapter extends adapter_core_1.Adapter {
    server = null;
    mqttClient = null;
    clientDevices = {};
    constructor(options = {}) {
        super({
            ...options,
            name: 'sonoff',
            ready: () => this.main(),
            unload: async (cb) => {
                if (this.server) {
                    await this.server.destroy();
                    this.server = null;
                }
                if (this.mqttClient) {
                    this.mqttClient.disconnect();
                    this.mqttClient = null;
                }
                if (typeof cb === 'function') {
                    cb();
                }
            },
            stateChange: (id, state) => {
                this.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
                if (state && !state.ack) {
                    const mode = this.config.mode || 'server';
                    if (mode === 'client') {
                        this.onClientStateChange(id, state).catch(err => this.log.error(`Cannot process state change: ${err.message}`));
                    }
                    else {
                        this.server
                            ?.onStateChange(id, state)
                            .catch(err => this.log.error(`Cannot process state change: ${err.message}`));
                    }
                }
            },
        });
    }
    async main() {
        this.subscribeStates('*');
        // read all states and set alive to false
        const states = await this.getStatesOfAsync('', '');
        if (states?.length) {
            for (const state of states) {
                if (state._id.match(/\.alive$/)) {
                    await this.setForeignStateAsync(state._id, false, true);
                }
            }
        }
        const mode = this.config.mode || 'server';
        if (mode === 'client') {
            this.log.info('Starting in CLIENT mode - connecting to external MQTT broker');
            await this.startClientMode();
        }
        else {
            this.log.info('Starting in SERVER mode - built-in MQTT broker');
            this.server = new server_1.default(this);
        }
    }
    // =====================================================================
    //  CLIENT MODE - Connect to external MQTT broker
    // =====================================================================
    async startClientMode() {
        // Ensure info.connection object exists before setting state
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connected to MQTT broker',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setStateAsync('info.connection', false, true);
        const brokerUrl = this.config.brokerUrl || 'localhost';
        const brokerPort = parseInt(this.config.brokerPort, 10) || 1883;
        const useTls = this.config.brokerUseTls || false;
        const protocol = useTls ? 'mqtts' : 'mqtt';
        const url = `${protocol}://${brokerUrl}:${brokerPort}`;
        this.mqttClient = new client_1.default(this, {
            url,
            user: this.config.brokerUser || '',
            password: this.config.brokerPassword || '',
            clientId: this.config.brokerClientId || `iobroker_sonoff_${this.instance}`,
            useTls,
            rejectUnauthorized: this.config.brokerTlsRejectUnauthorized !== false,
            caPath: this.config.brokerCaPath || '',
            certPath: this.config.brokerCertPath || '',
            keyPath: this.config.brokerKeyPath || '',
            topicPrefix: this.config.brokerTopicPrefix || '',
            topicStructure: this.config.brokerTopicStructure || 'standard',
            keepalive: parseInt(this.config.brokerKeepalive, 10) || 60,
            reconnectPeriod: parseInt(this.config.brokerReconnectPeriod, 10) || 5000,
            cleanSession: this.config.brokerCleanSession !== false,
        });
        this.mqttClient.onMessage = (topic, message, deviceId) => {
            this.processExternalMessage(topic, message, deviceId).catch(err => this.log.error(`Cannot process MQTT message: ${err.message}`));
        };
        this.mqttClient.onConnected = () => {
            this.log.info('Connected to external MQTT broker');
            this.setState('info.connection', true, true);
        };
        this.mqttClient.onDisconnected = () => {
            this.log.warn('Disconnected from external MQTT broker');
            this.setState('info.connection', false, true);
        };
        this.mqttClient.onError = (err) => {
            this.log.error(`MQTT client error: ${err.message}`);
        };
        this.mqttClient.onDeviceOnline = (deviceId) => {
            this.log.info(`Device [${deviceId}] detected via external MQTT broker`);
            this.clientDevices[deviceId] = { connected: true };
            this.setDeviceOnline(deviceId, true).catch(err => this.log.error(`Cannot set device online: ${err.message}`));
        };
        try {
            await this.mqttClient.connect();
        }
        catch (err) {
            this.log.error(`Cannot connect to external MQTT broker: ${err.message}`);
        }
    }
    // =====================================================================
    //  External MQTT message processing (client mode)
    // =====================================================================
    async processExternalMessage(topic, message, _deviceId) {
        this.log.debug(`MQTT message: ${topic} = ${message}`);
        const parts = topic.split('/');
        if (parts.length < 3) {
            this.log.debug(`Ignoring short topic: ${topic}`);
            return;
        }
        const prefix = parts[0]; // tele, stat, cmnd
        const device = parts[1]; // device name
        const command = parts.slice(2).join('/');
        const deviceId = device.replace(FORBIDDEN_CHARS, '_');
        // Ensure device is tracked
        if (!this.clientDevices[deviceId]) {
            this.clientDevices[deviceId] = { connected: true };
            await this.setDeviceOnline(deviceId, true);
        }
        if (prefix === 'tele') {
            await this.processTelemetry(deviceId, command, message);
        }
        else if (prefix === 'stat') {
            await this.processStatus(deviceId, command, message);
        }
        else {
            this.log.debug(`Unknown prefix "${prefix}" in topic "${topic}"`);
        }
    }
    async processTelemetry(deviceId, command, message) {
        if (command === 'LWT') {
            const isOnline = message === 'Online';
            await this.setDeviceOnline(deviceId, isOnline);
            if (isOnline) {
                this.clientDevices[deviceId] = { connected: true };
            }
            return;
        }
        if (command === 'STATE') {
            if (!this.config.TELE_STATE) {
                return;
            }
            try {
                const stateObj = JSON.parse(message);
                await this.processStateObject(deviceId, stateObj);
            }
            catch {
                this.log.warn(`Cannot parse tele STATE from ${deviceId}`);
            }
            return;
        }
        if (command === 'SENSOR') {
            if (!this.config.TELE_SENSOR) {
                return;
            }
            try {
                const sensorObj = JSON.parse(message);
                await this.processStateObject(deviceId, sensorObj);
            }
            catch {
                this.log.warn(`Cannot parse tele SENSOR from ${deviceId}`);
            }
            return;
        }
        if (command === 'RESULT') {
            try {
                const resultObj = JSON.parse(message);
                await this.processStateObject(deviceId, resultObj);
            }
            catch {
                this.log.warn(`Cannot parse tele RESULT from ${deviceId}`);
            }
            return;
        }
        if (command === 'ENERGY') {
            try {
                const energyObj = JSON.parse(message);
                await this.processStateObject(deviceId, energyObj, 'ENERGY');
            }
            catch {
                this.log.warn(`Cannot parse tele ENERGY from ${deviceId}`);
            }
            return;
        }
        if (command === 'MARGINS') {
            try {
                const marginsObj = JSON.parse(message);
                await this.processStateObject(deviceId, marginsObj, 'MARGINS');
            }
            catch {
                this.log.warn(`Cannot parse tele MARGINS from ${deviceId}`);
            }
            return;
        }
        if (command.startsWith('INFO')) {
            try {
                const infoObj = JSON.parse(message);
                await this.processStateObject(deviceId, infoObj, command);
            }
            catch {
                this.log.debug(`Cannot parse tele ${command} from ${deviceId}`);
            }
            return;
        }
        // Other telemetry messages (WAKEUP, etc.)
        try {
            const obj = JSON.parse(message);
            await this.processStateObject(deviceId, obj, command);
        }
        catch {
            // Not JSON, store as string
            await this.setTasmotaState(deviceId, command, message);
        }
    }
    async processStatus(deviceId, command, message) {
        if (command === 'RESULT') {
            if (!this.config.STAT_RESULT) {
                return;
            }
            try {
                const resultObj = JSON.parse(message);
                await this.processStateObject(deviceId, resultObj);
            }
            catch {
                this.log.warn(`Cannot parse stat RESULT from ${deviceId}`);
            }
            return;
        }
        // POWER, POWER1, POWER2, etc.
        if (command.startsWith('POWER')) {
            const val = message === 'ON' || message === '1' || message === 'true';
            await this.setTasmotaState(deviceId, command, val);
            return;
        }
        // STATUS responses (STATUS0..STATUS11)
        if (command.startsWith('STATUS')) {
            try {
                const statusObj = JSON.parse(message);
                await this.processStateObject(deviceId, statusObj, command);
            }
            catch {
                this.log.debug(`Cannot parse stat ${command} from ${deviceId}`);
            }
            return;
        }
        // Other stat messages
        try {
            const obj = JSON.parse(message);
            await this.processStateObject(deviceId, obj, command);
        }
        catch {
            await this.setTasmotaState(deviceId, command, message);
        }
    }
    async processStateObject(deviceId, obj, parentPath) {
        if (!obj || typeof obj !== 'object') {
            return;
        }
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            const path = parentPath ? `${parentPath}_${key}` : key;
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                if (this.config.OBJ_TREE) {
                    await this.processStateObject(deviceId, val, path);
                }
                else {
                    // Flatten using underscore separator
                    await this.processStateObject(deviceId, val, path);
                }
            }
            else {
                await this.setTasmotaState(deviceId, path, val);
            }
        }
    }
    async setTasmotaState(deviceId, stateKey, value) {
        // Ensure device object exists
        await this.setObjectNotExistsAsync(deviceId, {
            type: 'device',
            common: { name: deviceId },
            native: {},
        });
        // Check for known datapoint definition
        const dpDef = datapoints_1.default[stateKey];
        let processedValue = value;
        let type = typeof value;
        if (type === 'object') {
            processedValue = JSON.stringify(value);
            type = 'string';
        }
        let common;
        if (dpDef) {
            common = {
                name: stateKey,
                type: dpDef.type === 'mixed' ? 'string' : dpDef.type === 'array' ? 'string' : dpDef.type,
                role: dpDef.role,
                read: dpDef.read,
                write: dpDef.write,
            };
            if (dpDef.unit) {
                common.unit = dpDef.unit;
            }
            if (dpDef.min !== undefined) {
                common.min = dpDef.min;
            }
            if (dpDef.max !== undefined) {
                common.max = dpDef.max;
            }
            if (dpDef.states) {
                common.states = dpDef.states;
            }
        }
        else {
            common = {
                name: stateKey,
                type: type === 'boolean' ? 'boolean' : type === 'number' ? 'number' : 'string',
                role: type === 'boolean' ? 'switch' : type === 'number' ? 'value' : 'text',
                read: true,
                write: false,
            };
        }
        // Create folder structure for object tree mode
        if (this.config.OBJ_TREE) {
            const parts = stateKey.split('_');
            let path = deviceId;
            for (let i = 0; i < parts.length - 1; i++) {
                path += `.${parts[i]}`;
                await this.setObjectNotExistsAsync(path, {
                    type: 'channel',
                    common: { name: parts[i] },
                    native: {},
                });
            }
        }
        const stateObjId = this.config.OBJ_TREE ? `${deviceId}.${stateKey.replace(/_/g, '.')}` : `${deviceId}.${stateKey}`;
        await this.setObjectNotExistsAsync(stateObjId, {
            type: 'state',
            common,
            native: {},
        });
        // Convert value to correct type
        if (common.type === 'boolean') {
            processedValue =
                value === true || value === 'ON' || value === '1' || value === 'true' || value === 1;
        }
        else if (common.type === 'number') {
            processedValue = parseFloat(value);
            if (isNaN(processedValue)) {
                processedValue = 0;
            }
        }
        else {
            processedValue = String(value ?? '');
        }
        await this.setStateAsync(stateObjId, { val: processedValue, ack: true });
    }
    async setDeviceOnline(deviceId, online) {
        await this.setObjectNotExistsAsync(deviceId, {
            type: 'device',
            common: { name: deviceId },
            native: {},
        });
        await this.setObjectNotExistsAsync(`${deviceId}.alive`, {
            type: 'state',
            common: {
                name: 'Device online',
                type: 'boolean',
                role: 'indicator.reachable',
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setStateAsync(`${deviceId}.alive`, { val: online, ack: true });
    }
    // =====================================================================
    //  State change handling for client mode (send commands to Tasmota)
    // =====================================================================
    async onClientStateChange(id, state) {
        if (!this.mqttClient) {
            return;
        }
        // id format: sonoff.0.<deviceId>.<stateKey>
        const parts = id.split('.');
        if (parts.length < 4) {
            return;
        }
        const deviceId = parts[2];
        const stateKey = parts.slice(3).join('.');
        // Build MQTT command
        let command = stateKey;
        let payload = String(state.val ?? '');
        // Handle POWER commands
        if (stateKey.startsWith('POWER')) {
            payload = state.val ? 'ON' : 'OFF';
        }
        // Transform shutter state names to correct Tasmota command format
        const shutterMatch = command.match(/^Shutter(\d+)[_.]?(Position|Direction|Target|Tilt)$/);
        if (shutterMatch) {
            command = `Shutter${shutterMatch[2]}${shutterMatch[1]}`;
        }
        // Handle object tree state keys (replace dots with underscores for topic)
        if (this.config.OBJ_TREE) {
            command = command.replace(/\./g, '_');
        }
        const topic = `cmnd/${deviceId}/${command}`;
        this.log.debug(`Publishing command: ${topic} = ${payload}`);
        this.mqttClient.publish(topic, payload);
    }
}
exports.SonoffAdapter = SonoffAdapter;
if (require.main !== module) {
    module.exports = (options) => new SonoffAdapter(options);
}
else {
    (() => new SonoffAdapter())();
}
//# sourceMappingURL=main.js.map