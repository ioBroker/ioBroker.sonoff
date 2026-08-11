import mqtt from 'mqtt';
import MQTTBase, { FORBIDDEN_CHARS, type MQTTClient, type MQTTPacket } from './mqttBase';

interface PublishPacket {
    qos: 0 | 1 | 2;
    retain: boolean;
}

interface PendingMessage {
    topic: string;
    payload: Buffer;
    packet: PublishPacket;
}

export default class MQTTBridge extends MQTTBase {
    private mqttClient: ReturnType<typeof mqtt.connect> | null = null;
    private topicToHostname: Record<string, string> = {};
    private pendingMessages: Record<string, PendingMessage[]> = {};
    private pendingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    constructor(adapter: ioBroker.Adapter) {
        super(adapter);

        if (!this.config.externalBrokerUrl) {
            this.adapter.log.error('External broker URL is not configured');
            return;
        }

        this.connect();
    }

    async destroy(): Promise<void> {
        for (const topicPrefix in this.pendingTimers) {
            clearTimeout(this.pendingTimers[topicPrefix]);
        }
        this.pendingTimers = {};
        this.pendingMessages = {};

        if (this.mqttClient) {
            for (const id in this.clients) {
                await this.adapter.setForeignStateAsync(
                    `${this.adapter.namespace}.${this.clients[id].iobId}.alive`,
                    false,
                    true,
                );
            }
            await this.adapter.setStateAsync('info.connection', '', true);
            await new Promise<void>(resolve => this.mqttClient!.end(false, {}, () => resolve()));
            this.mqttClient = null;
        }
    }

    protected sendState2Client(client: MQTTClient, topic: string, state: ioBroker.StateValue, qos: 0 | 1 | 2): void {
        this.adapter.log.debug(`Send to external broker "${client.id}": ${topic} = ${state}`);
        this.mqttClient?.publish(topic, state === null ? 'null' : (state?.toString() ?? ''), { qos });
    }

    private normalizeUrl(url: string): string {
        if (!url.includes('://')) {
            return `mqtt://${url}`;
        }
        return url;
    }

    private connect(): void {
        const url = this.normalizeUrl(this.config.externalBrokerUrl);
        this.adapter.log.info(`Connecting to external MQTT broker: ${url}`);
        this.mqttClient = mqtt.connect(url, {
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
            this.mqttClient!.subscribe(['tele/#', 'stat/#'], { qos: this.config.defaultQoS }, err => {
                if (err) {
                    this.adapter.log.error(`Cannot subscribe to external broker: ${err.message}`);
                }
            });
            this.updateClients().catch(err => this.adapter.log.error(`Cannot update clients: ${err.message}`));
        });

        this.mqttClient.on('message', async (topic: string, payload: Buffer, packet: PublishPacket) => {
            await this.handleExternalMessage(topic, payload, packet).catch(err =>
                this.adapter.log.error(`Cannot handle external message: ${err.message}`),
            );
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

    private async createClientForDevice(topicPrefix: string, deviceName: string): Promise<MQTTClient> {
        const client = this.createPseudoClient(deviceName, topicPrefix);
        this.clients[client.id] = client;
        this.mappingClients[client.iobId] = client.id;
        this.createClient(client, () => {});
        await this.updateClients();
        this.adapter.log.debug(`Created device "${deviceName}" for topic prefix "${topicPrefix}"`);
        if (this.mqttClient) {
            this.mqttClient.publish(`cmnd/${topicPrefix}/Status`, '5');
            this.mqttClient.publish(`cmnd/${topicPrefix}/Status`, '2');
        }
        return client;
    }

    private async renameDevice(oldName: string, newName: string, topicPrefix: string): Promise<void> {
        this.adapter.log.info(`Renaming device "${oldName}" → "${newName}" (topic: "${topicPrefix}")`);

        const oldIobId = oldName.replace(FORBIDDEN_CHARS, '_');
        const newIobId = newName.replace(FORBIDDEN_CHARS, '_');
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
        this.createClient(newClient, () => {});
        delete this.clients[oldName];
        delete this.mappingClients[oldIobId];
        this.clients[newName] = newClient;
        this.mappingClients[newIobId] = newName;
        this.topicToHostname[topicPrefix] = newName;

        const objects = await this.adapter.getForeignObjectsAsync(`${oldPrefix}.*`);
        for (const [oldId, obj] of Object.entries(objects)) {
            const suffix = oldId.slice(oldPrefix.length);
            const newId = `${newPrefix}${suffix}`;
            const { _id, ...objWithoutId } = obj as ioBroker.Object & { _id: string };
            void _id;
            await this.adapter.setForeignObjectAsync(newId, objWithoutId as ioBroker.Object);
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

    private async processPending(topicPrefix: string, client: MQTTClient): Promise<void> {
        const pending = this.pendingMessages[topicPrefix];
        if (!pending?.length) {
            return;
        }
        delete this.pendingMessages[topicPrefix];
        for (const msg of pending) {
            const mqttPacket: MQTTPacket = {
                topic: msg.topic,
                payload: msg.payload,
                qos: msg.packet.qos,
                retain: msg.packet.retain,
                messageId: 0,
            };
            await this.receivedTopic(mqttPacket, client).catch(err =>
                this.adapter.log.error(`Error processing buffered message: ${err.message}`),
            );
        }
    }

    private async fallbackToTopicPrefix(topicPrefix: string): Promise<void> {
        delete this.pendingTimers[topicPrefix];
        if (this.topicToHostname[topicPrefix]) {
            return;
        }
        this.adapter.log.debug(
            `No STATE/Hostname received for "${topicPrefix}" within 30s, using topic prefix as device name`,
        );
        this.topicToHostname[topicPrefix] = topicPrefix;
        const client = await this.createClientForDevice(topicPrefix, topicPrefix);
        await this.processPending(topicPrefix, client);
    }

    private async resolveDeviceHostname(
        topicPrefix: string,
        newHostname: string,
        topic?: string,
        payload?: Buffer,
        packet?: PublishPacket,
    ): Promise<void> {
        const existingHostname = this.topicToHostname[topicPrefix];

        if (existingHostname === undefined) {
            if (this.pendingTimers[topicPrefix]) {
                clearTimeout(this.pendingTimers[topicPrefix]);
                delete this.pendingTimers[topicPrefix];
            }
            let client: MQTTClient;
            const topicIobId = topicPrefix.replace(FORBIDDEN_CHARS, '_');
            const newIobId = newHostname.replace(FORBIDDEN_CHARS, '_');
            const existingObj = await this.adapter.getForeignObjectAsync(`${this.adapter.namespace}.${topicIobId}`);
            if (existingObj && topicIobId !== newIobId) {
                await this.renameDevice(topicPrefix, newHostname, topicPrefix);
                client = this.clients[newHostname];
            } else {
                this.topicToHostname[topicPrefix] = newHostname;
                client = await this.createClientForDevice(topicPrefix, newHostname);
            }
            await this.processPending(topicPrefix, client);
            if (topic && payload && packet) {
                const mqttPacket: MQTTPacket = {
                    topic,
                    payload,
                    qos: packet.qos,
                    retain: packet.retain,
                    messageId: 0,
                };
                await this.receivedTopic(mqttPacket, client);
            }
        } else if (existingHostname !== newHostname) {
            await this.renameDevice(existingHostname, newHostname, topicPrefix);
            const client = this.clients[newHostname];
            if (client && topic && payload && packet) {
                const mqttPacket: MQTTPacket = {
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

    private async handleExternalMessage(topic: string, payload: Buffer, packet: PublishPacket): Promise<void> {
        const parts = topic.split('/');
        const topicPrefix = parts[1] || 'unknown';

        if (parts[0] === 'tele') {
            try {
                const data = JSON.parse(payload.toString()) as Record<string, unknown>;
                if (typeof data.Hostname === 'string' && data.Hostname) {
                    await this.resolveDeviceHostname(topicPrefix, data.Hostname, topic, payload, packet);
                    return;
                }
            } catch {
                // not valid JSON, fall through
            }
        }

        if (parts[0] === 'stat' && parts[2] === 'STATUS6') {
            try {
                const data = JSON.parse(payload.toString()) as Record<string, unknown>;
                const statusMqtt = data.StatusMQT as Record<string, unknown> | undefined;
                if (statusMqtt && typeof statusMqtt.MqttClient === 'string' && statusMqtt.MqttClient) {
                    await this.resolveDeviceHostname(topicPrefix, statusMqtt.MqttClient);
                    // fall through to normal routing so STATUS6 is also stored as ioBroker state
                }
            } catch {
                // not valid JSON, fall through
            }
        }

        const hostname = this.topicToHostname[topicPrefix];
        if (hostname !== undefined) {
            const client = this.clients[hostname];
            if (!client) {
                return;
            }
            const mqttPacket: MQTTPacket = {
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
            this.pendingTimers[topicPrefix] = setTimeout(
                () => this.fallbackToTopicPrefix(topicPrefix).catch(err => this.adapter.log.error(err.message)),
                30000,
            );
        }
    }

    private createPseudoClient(id: string, fallBackName: string): MQTTClient {
        const mqttClientRef = this.mqttClient;
        return {
            __secret: `${Date.now()}_${Math.round(Math.random() * 10000)}`,
            id,
            iobId: id.replace(FORBIDDEN_CHARS, '_'),
            cleanSession: true,
            _messages: [],
            _subsID: {},
            _subs: {},
            _resendonStart: null,
            _map: {},
            _fallBackName: fallBackName,
            publish: (packet: MQTTPacket | MQTTPacket[]) => {
                const pkts = Array.isArray(packet) ? packet : [packet];
                pkts.forEach(p =>
                    mqttClientRef?.publish(p.topic, p.payload, {
                        qos: p.qos || 0,
                        retain: p.retain || false,
                    }),
                );
            },
            connack: () => {},
            puback: () => {},
            pubrec: () => {},
            pubrel: () => {},
            pubcomp: () => {},
            unsuback: () => {},
            suback: () => {},
            pingresp: () => {},
            destroy: () => {},
            on: () => {},
            stream: { remoteAddress: 'external-broker', remotePort: 0 },
        };
    }
}
