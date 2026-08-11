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
const mqtt_1 = __importDefault(require("mqtt"));
const mqttBase_1 = __importStar(require("./mqttBase"));
class MQTTBridge extends mqttBase_1.default {
    mqttClient = null;
    topicToHostname = {};
    pendingMessages = {};
    pendingTimers = {};
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
        if (this.mqttClient) {
            for (const id in this.clients) {
                await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.${this.clients[id].iobId}.alive`, false, true);
            }
            await this.adapter.setStateAsync('info.connection', '', true);
            await new Promise(resolve => this.mqttClient.end(false, {}, () => resolve()));
            this.mqttClient = null;
        }
    }
    sendState2Client(client, topic, state, qos) {
        this.adapter.log.debug(`Send to external broker "${client.id}": ${topic} = ${state}`);
        this.mqttClient?.publish(topic, state === null ? 'null' : (state?.toString() ?? ''), { qos });
    }
    normalizeUrl(url) {
        if (!url.includes('://')) {
            return `mqtt://${url}`;
        }
        return url;
    }
    connect() {
        const url = this.normalizeUrl(this.config.externalBrokerUrl);
        this.adapter.log.info(`Connecting to external MQTT broker: ${url}`);
        this.mqttClient = mqtt_1.default.connect(url, {
            username: this.config.externalBrokerUser || undefined,
            password: this.config.externalBrokerPassword || undefined,
            clientId: `iobroker_sonoff_${this.adapter.namespace}`,
            reconnectPeriod: 5000,
        });
        this.mqttClient.on('connect', () => {
            this.adapter.log.info(`Connected to external MQTT broker ${url}`);
            this.adapter
                .setStateAsync('info.connection', url, true)
                .catch(err => this.adapter.log.error(`Cannot set connection state: ${err}`));
            this.mqttClient.subscribe(['tele/#', 'stat/#'], { qos: this.config.defaultQoS }, err => {
                if (err) {
                    this.adapter.log.error(`Cannot subscribe to external broker: ${err.message}`);
                }
            });
            this.updateClients().catch(err => this.adapter.log.error(`Cannot update clients: ${err.message}`));
        });
        this.mqttClient.on('message', async (topic, payload, packet) => {
            await this.handleExternalMessage(topic, payload, packet).catch(err => this.adapter.log.error(`Cannot handle external message: ${err.message}`));
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
    async createClientForDevice(topicPrefix, deviceName) {
        const client = this.createPseudoClient(deviceName, topicPrefix);
        this.clients[client.id] = client;
        this.mappingClients[client.iobId] = client.id;
        this.createClient(client, () => { });
        await this.updateClients();
        this.adapter.log.debug(`Created device "${deviceName}" for topic prefix "${topicPrefix}"`);
        if (this.mqttClient) {
            this.mqttClient.publish(`cmnd/${topicPrefix}/Status`, '5');
            this.mqttClient.publish(`cmnd/${topicPrefix}/Status`, '2');
        }
        return client;
    }
    async renameDevice(oldName, newName, topicPrefix) {
        this.adapter.log.info(`Renaming device "${oldName}" → "${newName}" (topic: "${topicPrefix}")`);
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
        this.topicToHostname[topicPrefix] = newName;
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
    async processPending(topicPrefix, client) {
        const pending = this.pendingMessages[topicPrefix];
        if (!pending?.length) {
            return;
        }
        delete this.pendingMessages[topicPrefix];
        for (const msg of pending) {
            const mqttPacket = {
                topic: msg.topic,
                payload: msg.payload,
                qos: msg.packet.qos,
                retain: msg.packet.retain,
                messageId: 0,
            };
            await this.receivedTopic(mqttPacket, client).catch(err => this.adapter.log.error(`Error processing buffered message: ${err.message}`));
        }
    }
    async fallbackToTopicPrefix(topicPrefix) {
        delete this.pendingTimers[topicPrefix];
        if (this.topicToHostname[topicPrefix]) {
            return;
        }
        this.adapter.log.debug(`No STATE/Hostname received for "${topicPrefix}" within 30s, using topic prefix as device name`);
        this.topicToHostname[topicPrefix] = topicPrefix;
        const client = await this.createClientForDevice(topicPrefix, topicPrefix);
        await this.processPending(topicPrefix, client);
    }
    async resolveDeviceHostname(topicPrefix, newHostname, topic, payload, packet) {
        const existingHostname = this.topicToHostname[topicPrefix];
        if (existingHostname === undefined) {
            if (this.pendingTimers[topicPrefix]) {
                clearTimeout(this.pendingTimers[topicPrefix]);
                delete this.pendingTimers[topicPrefix];
            }
            let client;
            const topicIobId = topicPrefix.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
            const newIobId = newHostname.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
            const existingObj = await this.adapter.getForeignObjectAsync(`${this.adapter.namespace}.${topicIobId}`);
            if (existingObj && topicIobId !== newIobId) {
                await this.renameDevice(topicPrefix, newHostname, topicPrefix);
                client = this.clients[newHostname];
            }
            else {
                this.topicToHostname[topicPrefix] = newHostname;
                client = await this.createClientForDevice(topicPrefix, newHostname);
            }
            await this.processPending(topicPrefix, client);
            if (topic && payload && packet) {
                const mqttPacket = {
                    topic,
                    payload,
                    qos: packet.qos,
                    retain: packet.retain,
                    messageId: 0,
                };
                await this.receivedTopic(mqttPacket, client);
            }
        }
        else if (existingHostname !== newHostname) {
            await this.renameDevice(existingHostname, newHostname, topicPrefix);
            const client = this.clients[newHostname];
            if (client && topic && payload && packet) {
                const mqttPacket = {
                    topic,
                    payload,
                    qos: packet.qos,
                    retain: packet.retain,
                    messageId: 0,
                };
                await this.receivedTopic(mqttPacket, client);
            }
        }
    }
    async handleExternalMessage(topic, payload, packet) {
        const parts = topic.split('/');
        const topicPrefix = parts[1] || 'unknown';
        if (parts[0] === 'tele') {
            try {
                const data = JSON.parse(payload.toString());
                if (typeof data.Hostname === 'string' && data.Hostname) {
                    await this.resolveDeviceHostname(topicPrefix, data.Hostname, topic, payload, packet);
                    return;
                }
            }
            catch {
                // not valid JSON, fall through
            }
        }
        if (parts[0] === 'stat' && parts[2] === 'STATUS6') {
            try {
                const data = JSON.parse(payload.toString());
                const statusMqtt = data.StatusMQT;
                if (statusMqtt && typeof statusMqtt.MqttClient === 'string' && statusMqtt.MqttClient) {
                    await this.resolveDeviceHostname(topicPrefix, statusMqtt.MqttClient);
                    // fall through to normal routing so STATUS6 is also stored as ioBroker state
                }
            }
            catch {
                // not valid JSON, fall through
            }
        }
        const hostname = this.topicToHostname[topicPrefix];
        if (hostname !== undefined) {
            const client = this.clients[hostname];
            if (!client) {
                return;
            }
            const mqttPacket = {
                topic,
                payload,
                qos: packet.qos,
                retain: packet.retain,
                messageId: 0,
            };
            await this.receivedTopic(mqttPacket, client);
            return;
        }
        if (!this.pendingMessages[topicPrefix]) {
            this.pendingMessages[topicPrefix] = [];
            this.mqttClient?.publish(`cmnd/${topicPrefix}/Status`, '6');
        }
        this.pendingMessages[topicPrefix].push({ topic, payload, packet });
        if (!this.pendingTimers[topicPrefix]) {
            this.pendingTimers[topicPrefix] = setTimeout(() => this.fallbackToTopicPrefix(topicPrefix).catch(err => this.adapter.log.error(err.message)), 30000);
        }
    }
    createPseudoClient(id, fallBackName) {
        const mqttClientRef = this.mqttClient;
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
                pkts.forEach(p => mqttClientRef?.publish(p.topic, p.payload, {
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