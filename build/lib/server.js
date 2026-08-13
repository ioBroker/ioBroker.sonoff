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
const node_net_1 = require("node:net");
// @ts-expect-error no types
const mqtt_connection_1 = __importDefault(require("mqtt-connection"));
const mqttBase_1 = __importStar(require("./mqttBase"));
/**
 * MQTT Server constructor
 */
class MQTTServer extends mqttBase_1.default {
    server;
    messageId = 1;
    persistentSessions = {};
    resending = false;
    resendTimer = null;
    constructor(adapter) {
        super(adapter);
        this.server = new node_net_1.Server();
        if (this.config.timeout === undefined) {
            this.config.timeout = 300;
        }
        else {
            this.config.timeout = parseInt(this.config.timeout, 10);
        }
        this.server.on('connection', stream => {
            const client = (0, mqtt_connection_1.default)(stream);
            // Store unique connection identifier
            client.__secret = `${Date.now()}_${Math.round(Math.random() * 10000)}`;
            // client connected
            client.on('connect', async (options) => {
                // acknowledge the "connect" packet
                client.id = options.clientId;
                client.iobId = client.id.replace(mqttBase_1.FORBIDDEN_CHARS, '_');
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
                    this.adapter.log.info(`Client [${client.id}] reconnected. Old secret ${this.clients[client.id].__secret} ==> New secret ${client.__secret}`);
                    // need to destroy the old client
                    if (client.__secret !== this.clients[client.id].__secret) {
                        // it is another socket!!
                        // It was following situation:
                        // - old connection was active
                        // - new connection is on the same TCP
                        // Just forget him
                        // oldClient.destroy();
                    }
                }
                else {
                    this.adapter.log.info(`Client [${client.id}] connected with secret ${client.__secret}`);
                }
                let sessionPresent = false;
                if (!client.cleanSession && this.config.storeClientsTime !== 0) {
                    if (this.persistentSessions[client.id]) {
                        sessionPresent = true;
                        this.persistentSessions[client.id].lastSeen = Date.now();
                    }
                    else {
                        this.persistentSessions[client.id] = {
                            _subsID: {},
                            _subs: {},
                            messages: [],
                            lastSeen: Date.now(),
                        };
                    }
                    client._messages = this.persistentSessions[client.id].messages;
                    this.persistentSessions[client.id].connected = true;
                }
                else if (client.cleanSession && this.persistentSessions[client.id]) {
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
                            client._resendonStart = setTimeout(clientId => {
                                client._resendonStart = null;
                                this.resendMessages2Client(client, this.persistentSessions[clientId].messages);
                            }, 100, client.id);
                        }
                    }
                });
            });
            // timeout idle streams after 5 minutes
            if (this.config.timeout) {
                stream.setTimeout(this.config.timeout * 1000);
            }
            // connection error handling
            client.on('close', hadError => this.clientClose(client, hadError ? 'closed because of error' : 'closed'));
            client.on('error', e => this.clientClose(client, e));
            client.on('disconnect', () => this.clientClose(client, 'disconnected'));
            // stream timeout
            stream.on('timeout', () => this.clientClose(client, 'timeout'));
            client.on('publish', async (packet) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends publish. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
                    return;
                }
                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }
                const packetStored = packet;
                if (packetStored.qos === 1) {
                    // send PUBACK to a client
                    client.puback({ messageId: packetStored.messageId });
                }
                else if (packet.qos === 2) {
                    const pack = client._messages?.find(e => e.messageId === packetStored.messageId);
                    if (pack) {
                        // duplicate message => ignore
                        this.adapter.log.warn(`Client [${client.id}] ignored duplicate message with ID: ${packetStored.messageId}`);
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
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubrec. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
                }
                else {
                    this.adapter.log.warn(`Client [${client.id}] received pubrec on ${client.id} for unknown message ID: ${packet.messageId}`);
                }
            });
            // response for QoS2
            client.on('pubcomp', packet => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubcomp. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
                }
                else {
                    this.adapter.log.warn(`Client [${client.id}] received pubcomp for unknown message ID: ${packet.messageId}`);
                }
            });
            // response for QoS2
            client.on('pubrel', async (packet) => {
                if (!client._messages) {
                    return;
                }
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubrel. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
                }
                else {
                    this.adapter.log.warn(`Client [${client.id}] received pubrel on ${client.id} for unknown messageId ${packet.messageId}`);
                }
            });
            // response for QoS1
            client.on('puback', (packet) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends puback. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
                    this.adapter.log.debug(`Client [${client.id}] received puback for ${client.id} message ID: ${packet.messageId}`);
                    client._messages?.splice(pos, 1);
                }
                else {
                    this.adapter.log.warn(`Client [${client.id}] received puback for unknown message ID: ${packet.messageId}`);
                }
            });
            client.on('unsubscribe', (packet) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends unsubscribe. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
                    return;
                }
                if (this.persistentSessions[client.id]) {
                    this.persistentSessions[client.id].lastSeen = Date.now();
                }
                client.unsuback({ messageId: packet.messageId });
            });
            client.on('subscribe', (packet) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends subscribe. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
            client.on('pingreq', ( /*packet*/) => {
                if (this.clients[client.id] && client.__secret !== this.clients[client.id].__secret) {
                    !this.config.ignorePings &&
                        this.adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pingreq. Ignore! Actual secret is ${this.clients[client.id].__secret}`);
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
        this.config.port = parseInt(this.config.port, 10) || 1883;
        this.config.retransmitInterval = this.config.retransmitInterval || 2000;
        this.config.retransmitCount = this.config.retransmitCount || 10;
        this.config.storeClientsTime =
            this.config.storeClientsTime === undefined
                ? 1440
                : parseInt(this.config.storeClientsTime, 10) || 0;
        // to start
        this.server.listen(this.config.port, this.config.bind, () => {
            this.adapter.log.info(`Starting MQTT ${this.config.user ? 'authenticated ' : ''} server on port ${this.config.port}`);
            // info.connection is filled with the list of the connected clients
            this.updateClients().catch(err => this.adapter.log.error(`Cannot update clients: ${err}`));
            this.resendTimer = setInterval(() => !this.resending && this.checkResends(), this.config.retransmitInterval || 2000);
        });
    }
    async destroy() {
        if (this.resendTimer) {
            clearInterval(this.resendTimer);
            this.resendTimer = null;
        }
        if (this.server) {
            for (const id in this.clients) {
                await this.adapter.setForeignStateAsync(`${this.adapter.namespace}.${this.clients[id].iobId}.alive`, false, true);
            }
            await this.adapter.setStateAsync('info.connection', '', true);
            // to release all resources
            return new Promise(resolve => this.server.close(() => resolve()));
        }
    }
    sendState2Client(client, topic, state, qos, retain, cb) {
        this.adapter.log.debug(`Send to "${client.id}": ${topic} = ${state}`);
        client.publish({
            topic,
            payload: state === null ? 'null' : state.toString(),
            qos,
            retain,
            messageId: this.messageId++,
        }, cb);
        this.messageId &= 0xffffffff;
    }
    resendMessages2Client(client, messages, i) {
        i = i || 0;
        if (messages && i < messages.length) {
            try {
                messages[i].ts = Date.now();
                messages[i].count++;
                this.adapter.log.debug(`Client [${client.id}] resend messages on connect: ${messages[i].topic} = ${messages[i].payload.toString()}`);
                if (messages[i].cmd === 'publish') {
                    client.publish(messages[i]);
                }
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot resend message: ${e}`);
            }
            if (this.config.sendInterval) {
                setTimeout(() => this.resendMessages2Client(client, messages, i + 1), this.config.sendInterval);
            }
            else {
                setImmediate(() => this.resendMessages2Client(client, messages, i + 1));
            }
        }
    }
    async clientClose(client, reason) {
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
        }
        catch (e) {
            this.adapter.log.warn(`Client [${client.id}] cannot close client: ${e}`);
        }
    }
    checkResends() {
        const now = Date.now();
        this.resending = true;
        for (const clientId in this.clients) {
            if (Object.prototype.hasOwnProperty.call(this.clients, clientId) && this.clients[clientId]?._messages) {
                for (let m = this.clients[clientId]._messages.length - 1; m >= 0; m--) {
                    const message = this.clients[clientId]._messages[m];
                    if (now - message.ts >= this.config.retransmitInterval) {
                        if (message.count > this.config.retransmitCount) {
                            this.adapter.log.warn(`Client [${clientId}] message ${message.messageId} deleted after ${message.count} retries`);
                            this.clients[clientId]._messages.splice(m, 1);
                            continue;
                        }
                        // resend this message
                        message.count++;
                        message.ts = now;
                        try {
                            this.adapter.log.debug(`Client [${clientId}] resend message topic: ${message.topic}, payload: ${message.payload.toString()}`);
                            if (message.cmd === 'publish') {
                                this.clients[clientId].publish(message);
                            }
                        }
                        catch (e) {
                            this.adapter.log.warn(`Client [${clientId}] cannot publish message: ${e}`);
                        }
                        if (this.config.sendInterval) {
                            setTimeout(() => this.checkResends(), this.config.sendInterval);
                        }
                        else {
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
                    if (now - this.persistentSessions[id].lastSeen > this.config.storeClientsTime * 60000) {
                        delete this.persistentSessions[id];
                    }
                }
            }
        }
        this.resending = false;
    }
}
exports.default = MQTTServer;
//# sourceMappingURL=server.js.map