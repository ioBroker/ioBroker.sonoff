"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mqtt = __importStar(require("mqtt"));
const node_fs_1 = __importDefault(require("node:fs"));
class MQTTClientWrapper {
    client = null;
    _connected = false;
    adapter;
    options;
    knownDevices = new Set();
    onMessage;
    onConnected;
    onDisconnected;
    onError;
    onDeviceOnline;
    constructor(adapter, options) {
        this.adapter = adapter;
        this.options = options;
    }
    get connected() {
        return this._connected;
    }
    async connect() {
        const connectOptions = {
            clientId: this.options.clientId,
            keepalive: this.options.keepalive || 60,
            reconnectPeriod: this.options.reconnectPeriod || 5000,
            clean: this.options.cleanSession !== false,
            protocolVersion: 4,
        };
        if (this.options.user) {
            connectOptions.username = this.options.user;
            connectOptions.password = this.options.password || '';
        }
        if (this.options.useTls) {
            connectOptions.rejectUnauthorized = this.options.rejectUnauthorized !== false;
            if (this.options.caPath) {
                try {
                    connectOptions.ca = node_fs_1.default.readFileSync(this.options.caPath);
                    this.adapter.log.debug('CA certificate loaded');
                }
                catch (err) {
                    this.adapter.log.warn(`Cannot read CA certificate: ${err.message}`);
                }
            }
            if (this.options.certPath) {
                try {
                    connectOptions.cert = node_fs_1.default.readFileSync(this.options.certPath);
                    this.adapter.log.debug('Client certificate loaded');
                }
                catch (err) {
                    this.adapter.log.warn(`Cannot read client certificate: ${err.message}`);
                }
            }
            if (this.options.keyPath) {
                try {
                    connectOptions.key = node_fs_1.default.readFileSync(this.options.keyPath);
                    this.adapter.log.debug('Client key loaded');
                }
                catch (err) {
                    this.adapter.log.warn(`Cannot read client key: ${err.message}`);
                }
            }
        }
        return new Promise(resolve => {
            this.adapter.log.info(`Connecting to MQTT broker: ${this.options.url}`);
            this.client = mqtt.connect(this.options.url, connectOptions);
            this.client.on('connect', () => {
                this._connected = true;
                this.adapter.log.info('Successfully connected to external MQTT broker');
                this.onConnected?.();
                this.subscribeToTasmotaTopics();
                resolve();
            });
            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message);
            });
            this.client.on('reconnect', () => {
                this.adapter.log.debug('Reconnecting to MQTT broker...');
            });
            this.client.on('close', () => {
                if (this._connected) {
                    this._connected = false;
                    this.onDisconnected?.();
                }
            });
            this.client.on('offline', () => {
                this._connected = false;
                this.adapter.log.debug('MQTT client offline');
            });
            this.client.on('error', (err) => {
                this.adapter.log.error(`MQTT client error: ${err.message}`);
                this.onError?.(err);
            });
            // Don't block adapter startup on connection timeout
            setTimeout(() => {
                if (!this._connected) {
                    this.adapter.log.warn('Initial MQTT connection timeout - will keep trying to reconnect');
                    resolve();
                }
            }, 10000);
        });
    }
    subscribeToTasmotaTopics() {
        const prefix = this.options.topicPrefix ? `${this.options.topicPrefix}/` : '';
        const deviceFirst = this.options.topicStructure === 'device-first';
        let topics;
        if (deviceFirst) {
            // Device-first structure: [prefix/]<device>/tele/<command>
            // Tasmota FullTopic: %topic%/%prefix%/ or tasmota/%topic%/%prefix%/
            topics = [
                // Wildcard subscriptions cover all commands
                `${prefix}+/tele/+`,
                `${prefix}+/stat/+`,
            ];
        }
        else {
            // Standard structure: [prefix/]tele/<device>/<command>
            // Tasmota FullTopic: %prefix%/%topic%/ (default)
            topics = [
                // Wildcard subscriptions cover all commands
                `${prefix}tele/+/+`,
                `${prefix}stat/+/+`,
            ];
        }
        const structureLabel = deviceFirst ? 'device-first' : 'standard';
        this.client?.subscribe(topics, { qos: 0 }, (err) => {
            if (err) {
                this.adapter.log.error(`Error subscribing to Tasmota topics: ${err.message}`);
            }
            else {
                this.adapter.log.info(`Subscribed to Tasmota topics (${structureLabel})${this.options.topicPrefix ? ` with prefix "${this.options.topicPrefix}"` : ''}`);
            }
        });
    }
    handleMessage(topic, messageBuffer) {
        const message = messageBuffer.toString();
        const prefix = this.options.topicPrefix;
        const deviceFirst = this.options.topicStructure === 'device-first';
        let effectiveTopic = topic;
        if (prefix && topic.startsWith(`${prefix}/`)) {
            effectiveTopic = topic.substring(prefix.length + 1);
        }
        const parts = effectiveTopic.split('/');
        if (parts.length < 3) {
            return;
        }
        let mqttPrefix;
        let deviceId;
        let command;
        if (deviceFirst) {
            // Device-first: <device>/tele/<command> or <device>/stat/<command>
            deviceId = parts[0];
            mqttPrefix = parts[1]; // tele, stat
            command = parts.slice(2).join('/');
        }
        else {
            // Standard: tele/<device>/<command> or stat/<device>/<command>
            mqttPrefix = parts[0]; // tele, stat
            deviceId = parts[1];
            command = parts.slice(2).join('/');
        }
        if (!this.knownDevices.has(deviceId)) {
            this.knownDevices.add(deviceId);
            this.onDeviceOnline?.(deviceId);
        }
        // Handle LWT (Last Will and Testament)
        if (mqttPrefix === 'tele' && command === 'LWT') {
            if (message === 'Offline') {
                this.knownDevices.delete(deviceId);
            }
        }
        // Normalize to standard format for processing: tele/<device>/<command>
        const normalizedTopic = `${mqttPrefix}/${deviceId}/${command}`;
        this.onMessage?.(normalizedTopic, message, deviceId);
    }
    /**
     * Publish an MQTT message.
     * @param topic - Topic in standard format: cmnd/<device>/<command>
     *   Will be automatically converted to device-first format if configured.
     */
    publish(topic, payload, options) {
        if (!this.client || !this._connected) {
            this.adapter.log.warn('Cannot publish - not connected to MQTT broker');
            return;
        }
        const prefix = this.options.topicPrefix;
        const deviceFirst = this.options.topicStructure === 'device-first';
        let effectiveTopic = topic;
        if (deviceFirst) {
            // Convert standard cmnd/<device>/<command> to <device>/cmnd/<command>
            const parts = topic.split('/');
            if (parts.length >= 3) {
                const mqttPrefix = parts[0]; // cmnd
                const device = parts[1];
                const command = parts.slice(2).join('/');
                effectiveTopic = `${device}/${mqttPrefix}/${command}`;
            }
        }
        const fullTopic = prefix ? `${prefix}/${effectiveTopic}` : effectiveTopic;
        this.client.publish(fullTopic, payload, options || { qos: 0, retain: false }, (err) => {
            if (err) {
                this.adapter.log.error(`Error publishing to ${fullTopic}: ${err.message}`);
            }
            else {
                this.adapter.log.debug(`Published: ${fullTopic} = ${payload}`);
            }
        });
    }
    disconnect() {
        if (this.client) {
            this._connected = false;
            this.client.end(true);
            this.client = null;
            this.adapter.log.info('Disconnected from external MQTT broker');
        }
    }
}
exports.default = MQTTClientWrapper;
//# sourceMappingURL=client.js.map