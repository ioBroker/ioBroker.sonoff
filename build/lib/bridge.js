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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const mqtt_1 = __importDefault(require("mqtt"));
const mqttBase_1 = __importStar(require("./mqttBase"));
/**
 * Where the name of a device comes from. A name from a less reliable source never overwrites
 * a name from a better one, so devices are not renamed back and forth with every message.
 */
const NAME_PRIORITY = {
    /** Fallback: the topic itself */
    topic: 0,
    /** "Hostname" from tele/.../STATE, tele/.../INFO2 or stat/.../STATUS5 */
    hostname: 1,
    /** "MqttClient" from stat/.../STATUS6 - the same name as with the built-in broker */
    mqttClient: 2,
};
const TASMOTA_PREFIXES = ['tele', 'stat', 'cmnd'];
// "tele/#" and "stat/#" are the standard full topics, "+/tele/+" and "+/stat/+" the device-first ones
const DEFAULT_TOPICS = ['tele/#', 'stat/#', '+/tele/+', '+/stat/+'];
const NAME_TIMEOUT_MS = 30_000;
const MAX_PENDING_MESSAGES = 100;
/**
 * MQTT bridge: connects as a client to an existing (external) MQTT broker
 * instead of starting an own broker. All message processing is shared with the
 * server implementation via MQTTBase.
 */
class MQTTBridge extends mqttBase_1.default {
    mqttClient = null;
    deviceNames = {};
    pendingMessages = {};
    pendingTimers = {};
    tasmotaTopics = new Set();
    topicStructures = {};
    reportedConflicts = new Set();
    /** All messages are processed strictly one after another */
    queue = Promise.resolve();
    constructor(adapter) {
        super(adapter);
        if (!this.config.externalBrokerUrl) {
            this.adapter.log.error('External broker URL is not configured');
            return;
        }
        this.connect();
    }
    async destroy() {
        for (const topicPrefix in this.pendingTimers) {
            clearTimeout(this.pendingTimers[topicPrefix]);
        }
        this.pendingTimers = {};
        this.pendingMessages = {};
        // wait till the currently processed message is done
        await this.queue.catch(() => { });
        if (this.mqttClient) {
            for (const id in this.clients) {
                await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.${this.clients[id].iobId}.alive`, false, true);
            }
            await this.adapter.setStateAsync('info.connection', '', true);
            await new Promise(resolve => this.mqttClient.end(false, {}, () => resolve()));
            this.mqttClient = null;
        }
    }
    /** In bridge mode info.connection shows the URL of the external broker, not the devices */
    async updateConnectionState() {
        // nothing to do, the state is set when the connection to the broker is established or lost
    }
    sendState2Client(client, topic, state, qos) {
        const brokerTopic = this.toBrokerTopic(topic);
        this.adapter.log.debug(`Send to external broker "${client.id}": ${brokerTopic} = ${state}`);
        this.mqttClient?.publish(brokerTopic, state === null ? 'null' : (state?.toString() ?? ''), { qos });
    }
    normalizeUrl(url) {
        if (!url.includes('://')) {
            return `mqtt://${url}`;
        }
        return url;
    }
    /** Topics to subscribe to. Can be configured, e.g. to support other full topics or OpenBeken devices */
    getSubscriptions() {
        const topics = (this.config.externalBrokerTopics || '')
            .split(/[,;\s]+/)
            .map(topic => topic.trim())
            .filter(topic => topic);
        return topics.length ? topics : DEFAULT_TOPICS;
    }
    /** Read an optional certificate file for encrypted connections */
    readCertificate(path, name) {
        if (!path) {
            return undefined;
        }
        try {
            return (0, node_fs_1.readFileSync)(path);
        }
        catch (err) {
            this.adapter.log.error(`Cannot read ${name} "${path}": ${err.message}`);
            return undefined;
        }
    }
    getConnectOptions() {
        const options = {
            username: this.config.externalBrokerUser || undefined,
            password: this.config.externalBrokerPassword || undefined,
            clientId: this.config.externalBrokerClientId || `iobroker_sonoff_${this.adapter.namespace}`,
            keepalive: parseInt(this.config.externalBrokerKeepalive, 10) || 60,
            clean: this.config.externalBrokerCleanSession !== false,
            reconnectPeriod: 5000,
        };
        // Certificates are only used for encrypted connections: mqtts://, ssl://, tls://, wss://
        if (this.normalizeUrl(this.config.externalBrokerUrl).includes('s://')) {
            options.rejectUnauthorized = this.config.externalBrokerRejectUnauthorized !== false;
            options.ca = this.readCertificate(this.config.externalBrokerCaPath, 'CA certificate');
            options.cert = this.readCertificate(this.config.externalBrokerCertPath, 'client certificate');
            options.key = this.readCertificate(this.config.externalBrokerKeyPath, 'client key');
        }
        return options;
    }
    connect() {
        const url = this.normalizeUrl(this.config.externalBrokerUrl);
        const subscriptions = this.getSubscriptions();
        this.adapter.log.info(`Connecting to external MQTT broker: ${url}`);
        this.mqttClient = mqtt_1.default.connect(url, this.getConnectOptions());
        this.mqttClient.on('connect', () => {
            this.adapter.log.info(`Connected to external MQTT broker ${url}`);
            this.adapter
                .setStateAsync('info.connection', url, true)
                .catch(err => this.adapter.log.error(`Cannot set connection state: ${err}`));
            this.mqttClient.subscribe(subscriptions, { qos: this.config.defaultQoS }, err => {
                if (err) {
                    this.adapter.log.error(`Cannot subscribe to external broker: ${err.message}`);
                }
                else {
                    this.adapter.log.info(`Subscribed to ${subscriptions.join(', ')}`);
                }
            });
            this.updateClients().catch(err => this.adapter.log.error(`Cannot update clients: ${err.message}`));
        });
        this.mqttClient.on('message', (topic, payload, packet) => {
            // Devices are created and renamed asynchronously, so the messages must not overlap
            this.queue = this.queue
                .then(() => this.handleExternalMessage(topic, payload, packet))
                .catch(err => this.adapter.log.error(`Cannot handle external message: ${err.message}`));
        });
        this.mqttClient.on('error', err => this.adapter.log.error(`External MQTT broker error: ${err.message}`));
        this.mqttClient.on('close', () => {
            this.adapter.log.debug('External MQTT broker connection closed');
            this.adapter
                .setStateAsync('info.connection', '', true)
                .catch(err => this.adapter.log.error(`Cannot set connection state: ${err}`));
        });
        this.mqttClient.on('reconnect', () => {
            this.adapter.log.debug('Reconnecting to external MQTT broker...');
        });
    }
    /**
     * Determine which device a topic belongs to and how the full topic is built:
     * - tele/device/STATE            => device, standard
     * - tele/house/floor/dev/STATE   => house/floor/dev, standard (nested full topics)
     * - device/tele/STATE            => device, device-first (full topic %topic%/%prefix%/)
     * - device/led_enableAll/get     => device, no tasmota structure (OpenBeken)
     */
    analyzeTopic(topic) {
        const parts = topic.split('/');
        const index = parts.findIndex(part => TASMOTA_PREFIXES.includes(part));
        if (index === 0) {
            return {
                device: parts.length > 2 ? parts.slice(1, -1).join('/') : '',
                structure: 'standard',
                standardTopic: topic,
            };
        }
        // the prefix stands directly before the command: device/tele/STATE
        if (index > 0 && index === parts.length - 2) {
            const device = parts.slice(0, index).join('/');
            return {
                device,
                structure: 'device-first',
                standardTopic: `${parts[index]}/${device}/${parts[parts.length - 1]}`,
            };
        }
        return { device: parts[0] || '', structure: null, standardTopic: topic };
    }
    /** Convert a standard topic (cmnd/device/POWER) into the structure the device uses */
    toBrokerTopic(topic) {
        const parts = topic.split('/');
        if (parts.length < 3 || !TASMOTA_PREFIXES.includes(parts[0])) {
            return topic;
        }
        const device = parts.slice(1, -1).join('/');
        if (this.topicStructures[device] !== 'device-first') {
            return topic;
        }
        return `${device}/${parts[0]}/${parts[parts.length - 1]}`;
    }
    publishCommand(device, command, payload) {
        this.mqttClient?.publish(this.toBrokerTopic(`cmnd/${device}/${command}`), payload);
    }
    toPacket(topic, payload, packet) {
        return {
            topic,
            payload,
            qos: packet.qos,
            retain: packet.retain,
            messageId: 0,
        };
    }
    /** Find the name of the device in the payload of a message */
    detectDeviceName(payload) {
        const text = payload.toString('utf8');
        if (!text.startsWith('{')) {
            return null;
        }
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            return null;
        }
        // stat/device/STATUS6 = {"StatusMQT":{"MqttClient":"DVES_123456", ...}}
        const mqttClient = data.StatusMQT?.MqttClient;
        if (typeof mqttClient === 'string' && mqttClient) {
            return { name: mqttClient, priority: NAME_PRIORITY.mqttClient };
        }
        // stat/device/STATUS5 = {"StatusNET":{"Hostname":"tasmota-1234", ...}}
        const netHostname = data.StatusNET?.Hostname;
        if (typeof netHostname === 'string' && netHostname) {
            return { name: netHostname, priority: NAME_PRIORITY.hostname };
        }
        // tele/device/STATE or tele/device/INFO2 = {..., "Hostname":"tasmota-1234", ...}
        if (typeof data.Hostname === 'string' && data.Hostname) {
            return { name: data.Hostname, priority: NAME_PRIORITY.hostname };
        }
        return null;
    }
    async createClientForDevice(topicPrefix, deviceName) {
        const client = this.createPseudoClient(deviceName, topicPrefix);
        this.clients[client.id] = client;
        this.mappingClients[client.iobId] = client.id;
        this.createClient(client, () => { });
        await this.updateClients();
        this.adapter.log.debug(`Created device "${deviceName}" for topic "${topicPrefix}"`);
        // The external broker keeps running while the adapter restarts, so the devices do not
        // repeat their boot messages. Ask them for the information which is normally sent in INFO2/INFO3
        if (this.tasmotaTopics.has(topicPrefix)) {
            this.publishCommand(topicPrefix, 'Status', '5');
            this.publishCommand(topicPrefix, 'Status', '2');
        }
        return client;
    }
    async renameDevice(oldName, newName, topicPrefix, priority) {
        if (oldName === newName) {
            return;
        }
        if (this.clients[newName]) {
            const conflict = `${topicPrefix}=>${newName}`;
            if (!this.reportedConflicts.has(conflict)) {
                this.reportedConflicts.add(conflict);
                this.adapter.log.warn(`Cannot rename device "${oldName}" (topic: "${topicPrefix}") to "${newName}": another device with this name already exists`);
            }
            return;
        }
        this.adapter.log.info(`Renaming device "${oldName}" => "${newName}" (topic: "${topicPrefix}")`);
        const oldIobId = oldName.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
        const newIobId = newName.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
        const oldPrefix = `${this.adapter.namespace}.${oldIobId}`;
        const newPrefix = `${this.adapter.namespace}.${newIobId}`;
        // Create new client and update routing maps synchronously BEFORE any awaits.
        // This ensures incoming messages during the async object migration are routed
        // to the new client name immediately, not the old one.
        const newClient = this.createPseudoClient(newName, topicPrefix);
        // Preserve existing topic mappings so commands work immediately after rename
        if (this.clients[oldName]?._map) {
            newClient._map = { ...this.clients[oldName]._map };
        }
        this.createClient(newClient, () => { });
        delete this.clients[oldName];
        delete this.mappingClients[oldIobId];
        this.clients[newName] = newClient;
        this.mappingClients[newIobId] = newName;
        this.deviceNames[topicPrefix] = { name: newName, priority };
        const objects = await this.adapter.getForeignObjectsAsync(`${oldPrefix}.*`);
        for (const [oldId, obj] of Object.entries(objects)) {
            const suffix = oldId.slice(oldPrefix.length);
            const newId = `${newPrefix}${suffix}`;
            const { _id, ...objWithoutId } = obj;
            void _id;
            await this.adapter.setForeignObjectAsync(newId, objWithoutId);
            if (obj.type === 'state') {
                const state = await this.adapter.getForeignStateAsync(oldId);
                if (state) {
                    await this.adapter.setForeignStateAsync(newId, state.val, state.ack);
                }
            }
            await this.adapter.delForeignObjectAsync(oldId);
        }
        await this.adapter.delForeignObjectAsync(oldPrefix);
        await this.updateClients();
    }
    /** Assign the detected name to a topic: create the device or rename an existing one */
    async applyDeviceName(topicPrefix, name, priority) {
        const current = this.deviceNames[topicPrefix];
        if (current) {
            if (current.name === name) {
                if (priority > current.priority) {
                    current.priority = priority;
                }
                return;
            }
            if (priority < current.priority) {
                // do not rename the device because of a less reliable source
                return;
            }
            await this.renameDevice(current.name, name, topicPrefix, priority);
            return;
        }
        if (this.pendingTimers[topicPrefix]) {
            clearTimeout(this.pendingTimers[topicPrefix]);
            delete this.pendingTimers[topicPrefix];
        }
        const topicIobId = topicPrefix.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
        if (topicIobId !== name.replace(mqttBase_1.FORBIDDEN_CHARS, '_')) {
            const existingObj = await this.adapter.getForeignObjectAsync(`${this.adapter.namespace}.${topicIobId}`);
            if (existingObj) {
                // The objects were created with the topic as fallback name => migrate them
                this.deviceNames[topicPrefix] = { name: topicPrefix, priority: NAME_PRIORITY.topic };
                await this.renameDevice(topicPrefix, name, topicPrefix, priority);
                // if the renaming was not possible, the device must exist with its old name
                await this.ensureClient(topicPrefix);
                await this.processPending(topicPrefix);
                return;
            }
        }
        this.deviceNames[topicPrefix] = { name, priority };
        await this.createClientForDevice(topicPrefix, name);
        await this.processPending(topicPrefix);
    }
    /** Make sure that a client exists for the current name of a topic */
    async ensureClient(topicPrefix) {
        const device = this.deviceNames[topicPrefix];
        if (device && !this.clients[device.name]) {
            await this.createClientForDevice(topicPrefix, device.name);
        }
    }
    /** Process the messages which arrived before the name of the device was known */
    async processPending(topicPrefix) {
        const pending = this.pendingMessages[topicPrefix];
        delete this.pendingMessages[topicPrefix];
        const device = this.deviceNames[topicPrefix];
        const client = device ? this.clients[device.name] : null;
        if (!pending?.length || !client) {
            return;
        }
        for (const msg of pending) {
            await this.receivedTopic(this.toPacket(msg.topic, msg.payload, msg.packet), client).catch(err => this.adapter.log.error(`Error processing buffered message: ${err.message}`));
        }
    }
    async fallbackToTopicPrefix(topicPrefix) {
        delete this.pendingTimers[topicPrefix];
        if (this.deviceNames[topicPrefix]) {
            return;
        }
        this.adapter.log.debug(`No device name received for "${topicPrefix}" within ${NAME_TIMEOUT_MS / 1000}s, using the topic as device name`);
        this.deviceNames[topicPrefix] = { name: topicPrefix, priority: NAME_PRIORITY.topic };
        await this.createClientForDevice(topicPrefix, topicPrefix);
        await this.processPending(topicPrefix);
    }
    /** Store a message till the name of the device is known */
    bufferMessage(topicPrefix, topic, payload, packet) {
        if (!this.pendingMessages[topicPrefix]) {
            this.pendingMessages[topicPrefix] = [];
            // ask the device how its MQTT client is called
            if (this.tasmotaTopics.has(topicPrefix)) {
                this.publishCommand(topicPrefix, 'Status', '6');
            }
        }
        const pending = this.pendingMessages[topicPrefix];
        if (pending.length >= MAX_PENDING_MESSAGES) {
            pending.shift();
        }
        pending.push({ topic, payload, packet });
        this.pendingTimers[topicPrefix] ||= setTimeout(() => {
            this.queue = this.queue
                .then(() => this.fallbackToTopicPrefix(topicPrefix))
                .catch(err => this.adapter.log.error(`Cannot create device "${topicPrefix}": ${err.message}`));
        }, NAME_TIMEOUT_MS);
    }
    async handleExternalMessage(topic, payload, packet) {
        const info = this.analyzeTopic(topic);
        const topicPrefix = info.device;
        if (!topicPrefix) {
            this.adapter.log.debug(`Ignore message with unexpected topic: ${topic}`);
            return;
        }
        if (info.structure) {
            this.tasmotaTopics.add(topicPrefix);
            this.topicStructures[topicPrefix] = info.structure;
        }
        // process the message like it would come with the standard full topic
        topic = info.standardTopic;
        // The name of the device can be part of this message
        const detected = this.detectDeviceName(payload);
        if (detected) {
            await this.applyDeviceName(topicPrefix, detected.name, detected.priority);
        }
        else if (!this.deviceNames[topicPrefix] && !this.tasmotaTopics.has(topicPrefix)) {
            // Devices which do not use the tasmota topics (e.g. OpenBeken) cannot be asked
            // for their name, so the topic is used immediately
            this.deviceNames[topicPrefix] = { name: topicPrefix, priority: NAME_PRIORITY.topic };
            await this.createClientForDevice(topicPrefix, topicPrefix);
            await this.processPending(topicPrefix);
        }
        const device = this.deviceNames[topicPrefix];
        if (device) {
            const client = this.clients[device.name];
            if (client) {
                await this.receivedTopic(this.toPacket(topic, payload, packet), client);
            }
            return;
        }
        this.bufferMessage(topicPrefix, topic, payload, packet);
    }
    createPseudoClient(id, fallBackName) {
        return {
            __secret: `${Date.now()}_${Math.round(Math.random() * 10000)}`,
            id,
            iobId: id.replace(mqttBase_1.FORBIDDEN_CHARS, '_'),
            cleanSession: true,
            _messages: [],
            _subsID: {},
            _subs: {},
            _resendonStart: null,
            _map: {},
            _fallBackName: fallBackName,
            publish: (packet) => {
                const pkts = Array.isArray(packet) ? packet : [packet];
                pkts.forEach(p => this.mqttClient?.publish(this.toBrokerTopic(p.topic), p.payload, {
                    qos: p.qos || 0,
                    retain: p.retain || false,
                }));
            },
            connack: () => { },
            puback: () => { },
            pubrec: () => { },
            pubrel: () => { },
            pubcomp: () => { },
            unsuback: () => { },
            suback: () => { },
            pingresp: () => { },
            destroy: () => { },
            on: () => { },
            stream: { remoteAddress: 'external-broker', remotePort: 0 },
        };
    }
}
exports.default = MQTTBridge;
//# sourceMappingURL=bridge.js.map