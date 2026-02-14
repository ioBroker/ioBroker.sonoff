'use strict';

const utils = require('@iobroker/adapter-core');
const adapterName = require('./package.json').name.split('.').pop();

let defined_datapoints;

class SonoffAdapter extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: adapterName,
        });

        this.clients = {};
        this.tasks = [];
        this.server = null;       // Built-in MQTT broker (server mode)
        this.mqttClient = null;   // External MQTT client (client mode)
        this.messageTimeout = null;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        defined_datapoints = require('./lib/datapoints');

        this.config.mode = this.config.mode || 'server';

        if (this.config.mode === 'client') {
            this.log.info('Starting in CLIENT mode - connecting to external MQTT broker');
            await this.startClientMode();
        } else {
            this.log.info('Starting in SERVER mode - built-in MQTT broker');
            await this.startServerMode();
        }

        this.subscribeStates('*');
    }

    // =====================================================================
    //  SERVER MODE - Built-in MQTT Broker (original functionality)
    // =====================================================================
    async startServerMode() {
        const MQTTServer = require('./lib/server');

        const port = parseInt(this.config.port, 10) || 1883;
        const bind = this.config.bind || '0.0.0.0';
        const user = this.config.user || '';
        const password = this.config.password || '';

        this.server = new MQTTServer(this, {
            port,
            bind,
            user,
            password,
            ssl: this.config.serverSsl || false,
            certPath: this.config.serverCertPath || '',
            keyPath: this.config.serverKeyPath || '',
        });

        this.server.on('message', (topic, message, clientId) => {
            this.processMqttMessage(topic, message, clientId);
        });

        this.server.on('clientConnected', (clientId) => {
            this.log.info(`Client [${clientId}] connected`);
            this.clients[clientId] = this.clients[clientId] || {};
            this.clients[clientId].connected = true;
            this.setDeviceOnline(clientId, true);
        });

        this.server.on('clientDisconnected', (clientId) => {
            this.log.info(`Client [${clientId}] disconnected`);
            if (this.clients[clientId]) {
                this.clients[clientId].connected = false;
            }
            this.setDeviceOnline(clientId, false);
        });

        try {
            await this.server.start();
            if (user) {
                this.log.info(`Starting MQTT authenticated server on port ${port}`);
            } else {
                this.log.info(`Starting MQTT server on port ${port}`);
            }
        } catch (err) {
            this.log.error(`Cannot start MQTT server on port ${port}: ${err.message}`);
        }
    }

    // =====================================================================
    //  CLIENT MODE - Connect to external MQTT broker
    // =====================================================================
    async startClientMode() {
        const MQTTClient = require('./lib/client');

        const brokerUrl = this.config.brokerUrl || 'localhost';
        const brokerPort = parseInt(this.config.brokerPort, 10) || 1883;
        const brokerUser = this.config.brokerUser || '';
        const brokerPassword = this.config.brokerPassword || '';
        const useTls = this.config.brokerUseTls || false;
        const tlsRejectUnauthorized = this.config.brokerTlsRejectUnauthorized !== false;
        const brokerCaPath = this.config.brokerCaPath || '';
        const brokerCertPath = this.config.brokerCertPath || '';
        const brokerKeyPath = this.config.brokerKeyPath || '';
        const clientId = this.config.brokerClientId || `iobroker_sonoff_${this.instance}`;
        const topicPrefix = this.config.brokerTopicPrefix || '';

        const protocol = useTls ? 'mqtts' : 'mqtt';
        const url = `${protocol}://${brokerUrl}:${brokerPort}`;

        this.log.info(`Connecting to external MQTT broker: ${url}`);

        this.mqttClient = new MQTTClient(this, {
            url,
            user: brokerUser,
            password: brokerPassword,
            clientId,
            useTls,
            rejectUnauthorized: tlsRejectUnauthorized,
            caPath: brokerCaPath,
            certPath: brokerCertPath,
            keyPath: brokerKeyPath,
            topicPrefix,
            keepalive: parseInt(this.config.brokerKeepalive, 10) || 60,
            reconnectPeriod: parseInt(this.config.brokerReconnectPeriod, 10) || 5000,
            cleanSession: this.config.brokerCleanSession !== false,
        });

        this.mqttClient.on('message', (topic, message, deviceId) => {
            this.processMqttMessage(topic, message, deviceId);
        });

        this.mqttClient.on('connected', () => {
            this.log.info('Connected to external MQTT broker');
            this.setState('info.connection', true, true);
        });

        this.mqttClient.on('disconnected', () => {
            this.log.warn('Disconnected from external MQTT broker');
            this.setState('info.connection', false, true);
        });

        this.mqttClient.on('error', (err) => {
            this.log.error(`MQTT client error: ${err.message}`);
        });

        this.mqttClient.on('deviceOnline', (deviceId) => {
            this.log.info(`Device [${deviceId}] detected via MQTT`);
            this.clients[deviceId] = this.clients[deviceId] || {};
            this.clients[deviceId].connected = true;
            this.setDeviceOnline(deviceId, true);
        });

        try {
            await this.mqttClient.connect();
        } catch (err) {
            this.log.error(`Cannot connect to external MQTT broker: ${err.message}`);
        }
    }

    // =====================================================================
    //  MQTT Message Processing (shared between server and client mode)
    // =====================================================================
    processMqttMessage(topic, message, clientId) {
        this.log.debug(`MQTT message: ${topic} = ${message} [from: ${clientId || 'unknown'}]`);

        const parts = topic.split('/');

        // Tasmota topic structure: <prefix>/<device>/<command>
        // tele/<device>/STATE, tele/<device>/SENSOR, tele/<device>/LWT
        // stat/<device>/RESULT, stat/<device>/POWER, stat/<device>/STATUS*
        // cmnd/<device>/POWER, cmnd/<device>/Backlog, etc.

        if (parts.length < 3) {
            this.log.debug(`Ignoring short topic: ${topic}`);
            return;
        }

        const prefix = parts[0];   // tele, stat, cmnd
        const device = parts[1];   // device name (clientId in Tasmota)
        const command = parts.slice(2).join('/');

        // Use device name from topic as clientId if not provided
        const deviceId = clientId || device;

        // Track this device
        if (!this.clients[deviceId]) {
            this.clients[deviceId] = { connected: true };
        }

        const msgStr = message.toString();

        if (prefix === 'tele') {
            this.processTelemetry(deviceId, command, msgStr);
        } else if (prefix === 'stat') {
            this.processStatus(deviceId, command, msgStr);
        } else {
            this.log.debug(`Unknown prefix "${prefix}" in topic "${topic}"`);
        }
    }

    processTelemetry(deviceId, command, message) {
        if (command === 'LWT') {
            const isOnline = message === 'Online';
            this.setDeviceOnline(deviceId, isOnline);
            if (isOnline) {
                this.clients[deviceId] = this.clients[deviceId] || {};
                this.clients[deviceId].connected = true;
            }
            return;
        }

        if (command === 'STATE') {
            if (!this.config.TELE_STATE) return;
            try {
                const stateObj = JSON.parse(message);
                this.processStateObject(deviceId, stateObj, 'STATE');
            } catch (e) {
                this.log.warn(`Cannot parse tele STATE from ${deviceId}: ${e.message}`);
            }
            return;
        }

        if (command === 'SENSOR') {
            if (!this.config.TELE_SENSOR) return;
            try {
                const sensorObj = JSON.parse(message);
                this.processStateObject(deviceId, sensorObj, 'SENSOR');
            } catch (e) {
                this.log.warn(`Cannot parse tele SENSOR from ${deviceId}: ${e.message}`);
            }
            return;
        }

        if (command === 'RESULT') {
            try {
                const resultObj = JSON.parse(message);
                this.processStateObject(deviceId, resultObj, 'RESULT');
            } catch (e) {
                this.log.warn(`Cannot parse tele RESULT from ${deviceId}: ${e.message}`);
            }
            return;
        }

        if (command === 'INFO1' || command === 'INFO2' || command === 'INFO3') {
            try {
                const infoObj = JSON.parse(message);
                this.processStateObject(deviceId, infoObj, command);
            } catch (e) {
                this.log.debug(`Cannot parse tele ${command} from ${deviceId}: ${e.message}`);
            }
            return;
        }

        // MARGINS, WAKEUP etc.
        try {
            const obj = JSON.parse(message);
            this.processStateObject(deviceId, obj, command);
        } catch (e) {
            // Not JSON, store as string
            this.setTasmotaState(deviceId, command, message);
        }
    }

    processStatus(deviceId, command, message) {
        if (command === 'RESULT') {
            if (!this.config.STAT_RESULT) return;
            try {
                const resultObj = JSON.parse(message);
                this.processStateObject(deviceId, resultObj, 'RESULT');
            } catch (e) {
                this.log.warn(`Cannot parse stat RESULT from ${deviceId}: ${e.message}`);
            }
            return;
        }

        // POWER, POWER1, POWER2, etc.
        if (command.startsWith('POWER')) {
            const val = message === 'ON' || message === '1' || message === 'true';
            this.setTasmotaState(deviceId, command, val);
            return;
        }

        // STATUS responses (STATUS0..STATUS11)
        if (command.startsWith('STATUS')) {
            try {
                const statusObj = JSON.parse(message);
                this.processStateObject(deviceId, statusObj, command);
            } catch (e) {
                this.log.debug(`Cannot parse stat ${command} from ${deviceId}: ${e.message}`);
            }
            return;
        }

        // Other stat messages
        try {
            const obj = JSON.parse(message);
            this.processStateObject(deviceId, obj, command);
        } catch (e) {
            this.setTasmotaState(deviceId, command, message);
        }
    }

    processStateObject(deviceId, obj, source, parentPath) {
        if (!obj || typeof obj !== 'object') return;

        for (const key of Object.keys(obj)) {
            const val = obj[key];
            const path = parentPath ? `${parentPath}.${key}` : key;

            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                this.processStateObject(deviceId, val, source, path);
            } else {
                this.setTasmotaState(deviceId, path, val);
            }
        }
    }

    async setTasmotaState(deviceId, stateKey, value) {
        const id = `${this.namespace}.${deviceId}.${stateKey}`;

        // Ensure device channel exists
        const deviceObj = {
            type: 'device',
            common: {
                name: deviceId,
            },
            native: {},
        };
        await this.setObjectNotExistsAsync(`${deviceId}`, deviceObj);

        // Check if we have a defined datapoint
        const dpDef = defined_datapoints[stateKey];

        let type = typeof value;
        if (type === 'object') {
            value = JSON.stringify(value);
            type = 'string';
        }

        const common = dpDef ? { ...dpDef.common } : {
            name: stateKey,
            type: type === 'boolean' ? 'boolean' : (type === 'number' ? 'number' : 'string'),
            role: type === 'boolean' ? 'switch' : (type === 'number' ? 'value' : 'text'),
            read: true,
            write: false,
        };

        if (this.config.OBJ_TREE) {
            // Create intermediate folders
            const parts = stateKey.split('.');
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

        await this.setObjectNotExistsAsync(`${deviceId}.${stateKey}`, {
            type: 'state',
            common,
            native: {},
        });

        // Convert value to correct type
        if (common.type === 'boolean') {
            value = value === true || value === 'ON' || value === '1' || value === 'true' || value === 1;
        } else if (common.type === 'number') {
            value = parseFloat(value);
            if (isNaN(value)) value = 0;
        } else {
            value = String(value);
        }

        await this.setStateAsync(`${deviceId}.${stateKey}`, { val: value, ack: true });
    }

    async setDeviceOnline(deviceId, online) {
        await this.setObjectNotExistsAsync(`${deviceId}`, {
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
    //  State Change Handling (send commands to Tasmota devices)
    // =====================================================================
    async onStateChange(id, state) {
        if (!state || state.ack) return;

        // id: sonoff.0.<deviceId>.<stateKey>
        const parts = id.split('.');
        if (parts.length < 4) return;

        const deviceId = parts[2];
        const stateKey = parts.slice(3).join('.');

        // Build MQTT command topic: cmnd/<deviceId>/<command>
        let command = stateKey;
        let payload = state.val;

        // Handle POWER commands
        if (stateKey.startsWith('POWER')) {
            payload = state.val ? 'ON' : 'OFF';
        }

        const topic = `cmnd/${deviceId}/${command}`;

        this.log.debug(`Publishing: ${topic} = ${payload}`);

        if (this.config.mode === 'client' && this.mqttClient) {
            this.mqttClient.publish(topic, String(payload));
        } else if (this.config.mode === 'server' && this.server) {
            this.server.publish(topic, String(payload), deviceId);
        }
    }

    // =====================================================================
    //  Adapter Shutdown
    // =====================================================================
    onUnload(callback) {
        try {
            if (this.mqttClient) {
                this.mqttClient.disconnect();
                this.mqttClient = null;
            }
            if (this.server) {
                this.server.stop();
                this.server = null;
            }
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
            }
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new SonoffAdapter(options);
} else {
    new SonoffAdapter();
}
