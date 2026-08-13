import { Server } from 'node:net';
// @ts-expect-error no types
import mqtt from 'mqtt-connection';
import MQTTBase, { FORBIDDEN_CHARS, type MQTTClient, type MQTTPacket, type MQTTPacketStored } from './mqttBase';

/**
 * MQTT Server constructor
 */
export default class MQTTServer extends MQTTBase {
    private readonly server: Server;
    private messageId = 1;
    private persistentSessions: {
        [id: string]: {
            connected?: boolean;
            lastSeen: number;
            messages: [];
            _subsID: { [key: string]: number };
            _subs: { [key: string]: string[] };
        };
    } = {};
    private resending = false;
    private resendTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(adapter: ioBroker.Adapter) {
        super(adapter);
        this.server = new Server();

        if (this.config.timeout === undefined) {
            this.config.timeout = 300;
        } else {
            this.config.timeout = parseInt(this.config.timeout as string, 10);
        }

        this.server.on('connection', stream => {
            const client: MQTTClient = mqtt(stream);
            // Store unique connection identifier
            client.__secret = `${Date.now()}_${Math.round(Math.random() * 10000)}`;

            // client connected
            client.on(
                'connect',
                async (options: {
                    clientId: string;
                    password?: string;
                    username?: string;
                    will?: MQTTPacket;
                }): Promise<void> => {
                    // acknowledge the "connect" packet
                    client.id = options.clientId;
                    client.iobId = client.id.replace(FORBIDDEN_CHARS, '_');
                    this.mappingClients[client.iobId] = client.id;

                    // get possible an old client
                    const oldClient = this.clients[client.id];

                    if (this.config.user) {
                        if (options.password) {
                            options.password = options.password.toString();
                        }
                        if (this.config.user !== options.username || this.config.password !== options.password) {
                            this.adapter.log.warn(`Client [${client.id}] has invalid password or username`);
                            client.connack({ returnCode: 4 });
                            if (oldClient) {
                                // delete existing client
                                delete this.clients[client.id];
                                await this.updateAlive(oldClient, false);
                                await this.updateClients();
                                oldClient.destroy();
                            }
                            client.destroy();
                            return;
                        }
                    }

                    if (oldClient) {
                        this.adapter.log.info(
                            `Client [${client.id}] reconnected. Old secret ${this.clients[client.id].__secret} ==> New secret ${client.__secret}`,
                        );
                        // need to destroy the old client

                        if (client.__secret !== this.clients[client.id].__secret) {
                            // it is another socket!!
                            // It was following situation:
                            // - old connection was active
                            // - new connection is on the same TCP
                            // Just forget him
                            // oldClient.destroy();
                        }
                    } else {
                        this.adapter.log.info(`Client [${client.id}] connected with secret ${client.__secret}`);
                    }

                    let sessionPresent = false;

                    if (!client.cleanSession && this.config.storeClientsTime !== 0) {
                        if (this.persistentSessions[client.id]) {
                            sessionPresent = true;
                            this.persistentSessions[client.id].lastSeen = Date.now();
                        } else {
                            this.persistentSessions[client.id] = {
                                _subsID: {},
                                _subs: {},
                                messages: [],
                                lastSeen: Date.now(),
                            };
                        }
                        client._messages = this.persistentSessions[client.id].messages;
                        this.persistentSessions[client.id].connected = true;
                    } else if (client.cleanSession && this.persistentSessions[client.id]) {
                        delete this.persistentSessions[client.id];
                    }
                    client._messages ||= [];

                    client.connack({ returnCode: 0, sessionPresent });
                    this.clients[client.id] = client;
                    await this.updateClients();

                    client._will = options.will;
                    this.createClient(client, () => {
                        if (this.persistentSessions[client.id]) {
                            client._subsID = this.persistentSessions[client.id]._subsID;
                            client._subs = this.persistentSessions[client.id]._subs;
                            if (this.persistentSessions[client.id].messages.length) {
                                // give to the client a little bit time
                                client._resendonStart = setTimeout(
                                    clientId => {
                                        client._resendonStart = null;
                                        this.resendMessages2Client(client, this.persistentSessions[clientId].messages);
                                    },
                                    100,
                                    client.id,
                                );
                            }
                        }
                    });
                },
            );

            // timeout idle streams after 5 minutes
            if (this.config.timeout) {
                stream.setTimeout((this.config.timeout as number) * 1000);
            }

            // connection error handling
            client.on('close', hadError => this.clientClose(client, hadError ? 'closed because of error' : 'closed'));
            client.on('error', e => this.clientClose(client, e));
            client.on('disconnect', () => this.clientClose(client, 'disconnected'));
            // stream timeout
            stream.on('timeout', () => this.clientClose(client, 'timeout'));

            client.on('publish', async (packet: MQTTPacket): Promise<void> => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends publish. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }
                const packetStored = packet as MQTTPacketStored;

                if (packetStored.qos === 1) {
                    // send PUBACK to a client
                    client.puback({ messageId: packetStored.messageId });
                } else if (packet.qos === 2) {
                    const pack = client._messages?.find(e => e.messageId === packetStored.messageId);
                    if (pack) {
                        // duplicate message => ignore
                        this.adapter.log.warn(
                            `Client [${client.id}] ignored duplicate message with ID: ${packetStored.messageId}`,
                        );
                        return;
                    }
                    packetStored.ts = Date.now();
                    packetStored.cmd = 'pubrel';
                    packetStored.count = 0;
                    client._messages.push(packetStored);

                    client.pubrec({ messageId: packetStored.messageId });
                    return;
                }

                await this.receivedTopic(packetStored, client);
            });

            // response for QoS2
            client.on('pubrec', packet => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends pubrec. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages?.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== null) {
                    client.pubrel({ messageId: packet.messageId });
                } else {
                    this.adapter.log.warn(
                        `Client [${client.id}] received pubrec on ${client.id} for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            // response for QoS2
            client.on('pubcomp', packet => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends pubcomp. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages?.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== null) {
                    client._messages?.splice(pos, 1);
                } else {
                    this.adapter.log.warn(
                        `Client [${client.id}] received pubcomp for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            // response for QoS2
            client.on('pubrel', async (packet: MQTTPacket): Promise<void> => {
                if (!client._messages) {
                    return;
                }
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends pubrel. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages?.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });

                if (pos !== null) {
                    client.pubcomp({ messageId: packet.messageId });

                    await this.receivedTopic(client._messages[pos], client);
                    client._messages?.splice(pos, 1);
                } else {
                    this.adapter.log.warn(
                        `Client [${client.id}] received pubrel on ${client.id} for unknown messageId ${packet.messageId}`,
                    );
                }
            });

            // response for QoS1
            client.on('puback', (packet: MQTTPacket): void => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends puback. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                let pos = null;
                // remove this message from queue
                client._messages?.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });

                if (pos !== null) {
                    this.adapter.log.debug(
                        `Client [${client.id}] received puback for ${client.id} message ID: ${packet.messageId}`,
                    );
                    client._messages?.splice(pos, 1);
                } else {
                    this.adapter.log.warn(
                        `Client [${client.id}] received puback for unknown message ID: ${packet.messageId}`,
                    );
                }
            });

            client.on('unsubscribe', (packet: MQTTPacket): void => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends unsubscribe. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                client.unsuback({ messageId: packet.messageId });
            });

            client.on('subscribe', (packet: { subscriptions: { qos: 0 | 1 | 2 }[]; messageId: number }): void => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends subscribe. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                // just confirm the request.
                // we expect subscribe for 'cmnd.sonoff.#'
                const granted = packet.subscriptions.map(subs => subs.qos);

                client.suback({ granted: granted, messageId: packet.messageId });
            });

            client.on('pingreq', (/*packet*/) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(
                            `Old client ${client.id} with secret ${client.__secret} sends pingreq. Ignore! Actual secret is ${this.clients[client.id].__secret}`,
                        );
                    return;
                }

                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }

                this.adapter.log.debug(`Client [${client.id}] pingreq`);
                client.pingresp();
            });
        });

        this.server.on('error', err => this.adapter.log.error(`Can not start Server ${err}`));

        this.config.port = parseInt(this.config.port as string, 10) || 1883;

        this.config.retransmitInterval = this.config.retransmitInterval || 2000;
        this.config.retransmitCount = this.config.retransmitCount || 10;
        this.config.storeClientsTime =
            this.config.storeClientsTime === undefined
                ? 1440
                : parseInt(this.config.storeClientsTime as string, 10) || 0;

        // to start
        this.server.listen(this.config.port, this.config.bind, () => {
            this.adapter.log.info(
                `Starting MQTT ${this.config.user ? 'authenticated ' : ''} server on port ${this.config.port}`,
            );
            // info.connection is filled with the list of the connected clients
            this.updateClients().catch(err => this.adapter.log.error(`Cannot update clients: ${err}`));

            this.resendTimer = setInterval(
                () => !this.resending && this.checkResends(),
                this.config.retransmitInterval || 2000,
            );
        });
    }

    async destroy(): Promise<void> {
        if (this.resendTimer) {
            clearInterval(this.resendTimer);
            this.resendTimer = null;
        }

        if (this.server) {
            for (const id in this.clients) {
                await this.adapter.setForeignStateAsync(
                    `${this.adapter.namespace}.${this.clients[id].iobId}.alive`,
                    false,
                    true,
                );
            }
            await this.adapter.setStateAsync('info.connection', '', true);

            // to release all resources
            return new Promise(resolve => this.server.close(() => resolve()));
        }
    }

    protected sendState2Client(
        client: MQTTClient,
        topic: string,
        state: ioBroker.StateValue,
        qos: 0 | 1 | 2,
        retain?: boolean,
        cb?: () => void,
    ): void {
        this.adapter.log.debug(`Send to "${client.id}": ${topic} = ${state}`);
        client.publish(
            {
                topic,
                payload: state === null ? 'null' : state.toString(),
                qos,
                retain,
                messageId: this.messageId++,
            },
            cb,
        );
        this.messageId &= 0xffffffff;
    }

    private resendMessages2Client(client: MQTTClient, messages: MQTTPacketStored[], i?: number): void {
        i = i || 0;
        if (messages && i < messages.length) {
            try {
                messages[i].ts = Date.now();
                messages[i].count++;
                this.adapter.log.debug(
                    `Client [${client.id}] resend messages on connect: ${messages[i].topic} = ${messages[i].payload.toString()}`,
                );
                if (messages[i].cmd === 'publish') {
                    client.publish(messages[i]);
                }
            } catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot resend message: ${e}`);
            }

            if (this.config.sendInterval) {
                setTimeout(() => this.resendMessages2Client(client, messages, i + 1), this.config.sendInterval);
            } else {
                setImmediate(() => this.resendMessages2Client(client, messages, i + 1));
            }
        }
    }

    private async clientClose(client: MQTTClient, reason: string): Promise<void> {
        if (!client) {
            return;
        }

        if (this.persistentSessions[client.id]) {
            this.persistentSessions[client.id].connected = false;
        }

        if (client._resendonStart) {
            clearTimeout(client._resendonStart);
            client._resendonStart = null;
        }

        try {
            if (this.clients[client.id] && client.__secret === this.clients[client.id].__secret) {
                this.adapter.log.info(`Client [${client.id}] connection closed: ${reason}`);
                await this.updateAlive(client, false);
                delete this.clients[client.id];
                await this.updateClients();
                if (client._will) {
                    await this.receivedTopic(client._will, client);
                }
            }
            client.destroy();
        } catch (e) {
            this.adapter.log.warn(`Client [${client.id}] cannot close client: ${e}`);
        }
    }

    private checkResends(): void {
        const now = Date.now();
        this.resending = true;
        for (const clientId in this.clients) {
            if (Object.prototype.hasOwnProperty.call(this.clients, clientId) && this.clients[clientId]?._messages) {
                for (let m = this.clients[clientId]._messages.length - 1; m >= 0; m--) {
                    const message = this.clients[clientId]._messages[m];
                    if (now - message.ts >= this.config.retransmitInterval) {
                        if (message.count > this.config.retransmitCount) {
                            this.adapter.log.warn(
                                `Client [${clientId}] message ${message.messageId} deleted after ${message.count} retries`,
                            );
                            this.clients[clientId]._messages.splice(m, 1);
                            continue;
                        }

                        // resend this message
                        message.count++;
                        message.ts = now;
                        try {
                            this.adapter.log.debug(
                                `Client [${clientId}] resend message topic: ${message.topic}, payload: ${message.payload.toString()}`,
                            );
                            if (message.cmd === 'publish') {
                                this.clients[clientId].publish(message);
                            }
                        } catch (e) {
                            this.adapter.log.warn(`Client [${clientId}] cannot publish message: ${e}`);
                        }

                        if (this.config.sendInterval) {
                            setTimeout(() => this.checkResends(), this.config.sendInterval);
                        } else {
                            setImmediate(() => this.checkResends());
                        }
                        return;
                    }
                }
            }
        }

        // delete old sessions
        if (this.config.storeClientsTime !== -1) {
            for (const id in this.persistentSessions) {
                if (Object.prototype.hasOwnProperty.call(this.persistentSessions, id)) {
                    if (now - this.persistentSessions[id].lastSeen > (this.config.storeClientsTime as number) * 60000) {
                        delete this.persistentSessions[id];
                    }
                }
            }
        }

        this.resending = false;
    }
}
