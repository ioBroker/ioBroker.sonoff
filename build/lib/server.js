"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = require("node:net");
// @ts-expect-error no types
const mqtt_connection_1 = __importDefault(require("mqtt-connection"));
const datapoints_1 = __importDefault(require("./datapoints"));
const hueCalc = true;
const FORBIDDEN_CHARS = /[\]\\[*,;'"`<>\\?]/g;
/*
 * HSV to RGB color conversion
 *
 * H runs from 0 to 360 degrees
 * S and V run from 0 to 100
 *
 * Ported from the excellent java algorithm by Eugene Vishnevsky at:
 * http://www.cs.rit.edu/~ncs/color/t_convert.html
 */
function hsvToRgb(h, s, v) {
    let r;
    let g;
    let b;
    // Make sure our arguments stay in-range
    h = Math.max(0, Math.min(360, h));
    s = Math.max(0, Math.min(100, s));
    v = Math.max(0, Math.min(100, v));
    // We accept saturation and value arguments from 0 to 100 because that's
    // how Photoshop represents those values. Internally, however, the
    // saturation and value are calculated from a range of 0 to 1. We make
    // That conversion here.
    s /= 100;
    v /= 100;
    if (s === 0) {
        // Achromatic (grey)
        r = g = b = v;
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
    h /= 60; // sector 0 to 5
    const i = Math.floor(h);
    const f = h - i; // factorial part of h
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));
    switch (i) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;
        case 1:
            r = q;
            g = v;
            b = p;
            break;
        case 2:
            r = p;
            g = v;
            b = t;
            break;
        case 3:
            r = p;
            g = q;
            b = v;
            break;
        case 4:
            r = t;
            g = p;
            b = v;
            break;
        default: // case 5:
            r = v;
            g = p;
            b = q;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
}
function toPaddedHexString(num, len) {
    if (len === 2) {
        if (num > 255) {
            num = 255;
        }
    }
    const str = num.toString(16);
    if (str.length >= len) {
        return str;
    }
    return '0'.repeat(len - str.length) + str;
}
const NO_PREFIX = '';
/**
 * MQTT Server constructor
 */
class MQTTServer {
    server;
    clients = {};
    tasks = [];
    taskCallbacks = [];
    messageId = 1;
    persistentSessions = {};
    resending = false;
    resendTimer = null;
    mappingClients = {};
    adapter;
    cacheAddedObjects = {};
    cachedModeExor = {};
    cachedReadColors = {};
    cachePowerObjects = {};
    specVars = [
        'Red',
        'Green',
        'Blue',
        'WW',
        'CW',
        'Color',
        'RGB_POWER',
        'WW_POWER',
        'CW_POWER',
        'Hue',
        'Saturation',
    ];
    config;
    constructor(adapter) {
        this.server = new node_net_1.Server();
        this.adapter = adapter;
        this.config = this.adapter.config;
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
            client.on('close', had_error => this.clientClose(client, had_error ? 'closed because of error' : 'closed'));
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
        this.config.defaultQoS = parseInt(this.config.defaultQoS, 10) || 0;
        // Update connection state
        this.updateClients().catch(err => this.adapter.log.error(`Cannot update connection state: ${err}`));
        // to start
        this.server.listen(this.config.port, this.config.bind, () => {
            this.adapter.log.info(`Starting MQTT ${this.config.user ? 'authenticated ' : ''} server on port ${this.config.port}`);
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
            // to release all resources
            return new Promise(resolve => this.server.close(() => resolve()));
        }
    }
    setColor(channelId, val) {
        //this.adapter.log.info('color write: '+ val);
        const stateId = 'Color';
        if (this.clients[channelId]?._map?.[stateId]) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], this.clients[channelId]._map[stateId] || 'cmnd/sonoff/Color', val, this.config.defaultQoS));
        }
        else if (this.clients[channelId]?._fallBackName) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], `cmnd/${this.clients[channelId]._fallBackName}/${stateId}`, val, this.config.defaultQoS));
        }
        else {
            this.adapter.log.warn(`Unknown mapping for "${stateId}"`);
        }
    }
    setPower(channelId, val) {
        const stateId = 'POWER';
        if (val === '' || val === null || val === undefined) {
            return this.adapter.log.debug('Empty power was ignored');
        }
        if (this.clients[channelId]._map?.[stateId]) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], this.clients[channelId]._map[stateId] || 'cmnd/sonoff/POWER', val ? 'ON' : 'OFF', this.config.defaultQoS));
        }
        else if (this.clients[channelId]._fallBackName) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], `cmnd/${this.clients[channelId]._fallBackName}/${stateId}`, val, this.config.defaultQoS));
        }
        else {
            this.adapter.log.warn(`Unknown mapping for "${stateId}"`);
        }
    }
    setZbSendCommand(channelId, deviceId, attribute, val) {
        // Send Zigbee command via ZbSend
        const zbSendCommand = JSON.stringify({
            device: deviceId,
            send: {
                [attribute]: val,
            },
        });
        if (this.clients[channelId]?._fallBackName) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], `cmnd/${this.clients[channelId]._fallBackName}/ZbSend`, zbSendCommand, this.config.defaultQoS));
        }
        else {
            this.adapter.log.warn(`Cannot send ZbSend command for device ${deviceId}: client not found`);
        }
    }
    /**
     * Transform shutter state names to correct Tasmota command format
     * e.g., "Shutter1_Position" -> "ShutterPosition1"
     * e.g., "Shutter1_Tilt" -> "ShutterTilt1"
     *
     * @param stateId - The original state ID to transform
     * @returns The transformed state ID for Tasmota commands
     */
    transformShutterStateId(stateId) {
        const shutterMatch = stateId.match(/^Shutter(\d+)_(Position|Direction|Target|Tilt)$/);
        if (shutterMatch) {
            const shutterNumber = shutterMatch[1];
            const command = shutterMatch[2];
            return `Shutter${command}${shutterNumber}`;
        }
        return stateId;
    }
    setStateImmediate(channelId, stateId, val) {
        // Transform shutter state names to correct Tasmota command format
        const transformedStateId = this.transformShutterStateId(stateId);
        if (this.clients[channelId]?._map?.[stateId]) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], this.clients[channelId]._map[stateId] || `cmnd/sonoff/${transformedStateId}`, val, this.config.defaultQoS));
        }
        else if (this.clients[channelId]?._fallBackName) {
            setImmediate(() => this.sendState2Client(this.clients[channelId], `cmnd/${this.clients[channelId]._fallBackName}/${transformedStateId}`, val, this.config.defaultQoS));
        }
        else {
            this.adapter.log.warn(`Unknown mapping for "${stateId}"`);
        }
    }
    async _setState(id, val) {
        this.adapter.log.debug(`Set state after task: ${id}`);
        await this.adapter.setForeignStateAsync(id, val, true);
    }
    updateState(task, val, callback) {
        if (typeof val === 'function') {
            callback = val;
            val = undefined;
        }
        if (val !== undefined) {
            task.setState = true;
            task.setValue = val;
        }
        this.tasks.push(task);
        if (callback) {
            this.taskCallbacks.push(callback);
        }
        this.adapter.log.debug(`Update state ${task.id} - ${this.tasks.length}`);
        if (this.tasks.length === 1) {
            this.processTasks().catch(err => this.adapter.log.error(err));
        }
    }
    async onStateChangedColors(id, state, channelId, stateId) {
        if (!channelId) {
            const parts = id.split('.');
            stateId = parts.pop() || '';
            if (stateId === 'level' ||
                stateId === 'state' ||
                stateId === 'red' ||
                stateId === 'blue' ||
                stateId === 'green') {
                stateId = `${parts.pop()}.${stateId}`;
            }
            channelId = parts.splice(2, parts.length).join('.');
        }
        const ledModeIdExor = `${this.adapter.namespace}.${channelId}.modeLedExor`;
        if (this.cachedModeExor[ledModeIdExor] === undefined) {
            const _state = await this.adapter.getForeignStateAsync(ledModeIdExor);
            this.cachedModeExor[ledModeIdExor] = _state ? _state.val || false : true;
            setImmediate(() => this.onStateChangedColors(id, state, channelId, stateId));
            return;
        }
        // ledstripe objects
        const exorWhiteLeds = this.cachedModeExor[ledModeIdExor]; // exor for white leds and color leds  => if white leds are switched on, color leds are switched off and vice versa (default on)
        // now evaluate ledstripe vars
        // adaptions for magichome tasmota
        if (stateId?.match(/Color\d?/)) {
            //this.adapter.log.info('sending color');
            // id = sonoff.0.DVES_96ABFA.Color
            // statid=Color
            // state = {"val":"#faadcf","ack":false,"ts":1520146102580,"q":0,"from":"system.this.adapter.web.0","lc":1520146102580}
            // set white to rgb or rgbww
            const obj = await this.adapter.getObjectAsync(id);
            if (!obj) {
                this.adapter.log.warn(`Invalid rgbww obj for ${id}`);
            }
            else if (typeof state.val !== 'string') {
                this.adapter.log.warn(`Invalid rgbww state value for ${id} : ${JSON.stringify(state.val)} needs to be a string`);
            }
            else {
                const role = obj.common.role;
                let color;
                //this.adapter.log.info(state.val);
                if (role === 'level.color.rgbww') {
                    // rgbww
                    if (state.val.toUpperCase() === '#FFFFFF') {
                        // transform white to WW
                        //color='000000FF';
                        color = `${state.val.substring(1)}00`;
                    }
                    else {
                        // strip # char and add ww
                        color = `${state.val.substring(1)}00`;
                    }
                }
                else if (role === 'level.color.rgbcwww') {
                    color = `${state.val.substring(1)}0000`;
                }
                else {
                    // rgb, strip # char
                    color = state.val.substring(1);
                }
                //this.adapter.log.info('color :' + color + ' : ' + role);
                // strip # char
                //color=state.val.substring(1);
                this.setColor(channelId, color);
                // set rgb too
                const hidE = id.split('.');
                const deviceDesc = `${hidE[0]}.${hidE[1]}.${hidE[2]}`;
                await this.adapter.setStateAsync(`${deviceDesc}.Red`, (100 * parseInt(color.substring(0, 2), 16)) / 255, true);
                await this.adapter.setStateAsync(`${deviceDesc}.Green`, (100 * parseInt(color.substring(2, 4), 16)) / 255, true);
                await this.adapter.setStateAsync(`${deviceDesc}.Blue`, (100 * parseInt(color.substring(4, 6), 16)) / 255, true);
            }
            return;
        }
        const hidE = id.split('.');
        const deviceDesc = `${hidE[0]}.${hidE[1]}.${hidE[2]}`;
        if (stateId?.match(/Red\d?/)) {
            // set red component
            if (state.val > 100) {
                state.val = 100;
            }
            const red = toPaddedHexString(Math.floor((255 * state.val) / 100), 2);
            const idAlive = `${deviceDesc}.Color`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state) {
                await this.adapter.setStateAsync(idAlive, '#000000', false);
                return;
            }
            const color = _state.val?.toString().substring(1) || '000000';
            // replace red component
            const out = red + color.substring(2, 10);
            await this.adapter.setStateAsync(idAlive, `#${out}`, false);
            this.setColor(channelId, out);
        }
        else if (stateId?.match(/Green\d?/)) {
            // set green component
            if (state.val > 100) {
                state.val = 100;
            }
            const green = toPaddedHexString(Math.floor((255 * state.val) / 100), 2);
            const idAlive = `${deviceDesc}.Color`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state) {
                await this.adapter.setStateAsync(idAlive, '#000000', false);
                return;
            }
            const color = _state.val?.toString().substring(1) || '000000';
            // replace green component
            const out = color.substring(0, 2) + green + color.substring(4, 10);
            await this.adapter.setStateAsync(idAlive, `#${out}`, false);
            this.setColor(channelId, out);
            return;
        }
        if (stateId?.match(/Blue\d?/)) {
            // set blue component
            if (state.val > 100) {
                state.val = 100;
            }
            const blue = toPaddedHexString(Math.floor((255 * state.val) / 100), 2);
            const idAlive = `${deviceDesc}.Color`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state) {
                await this.adapter.setStateAsync(idAlive, '#000000', false);
                return;
            }
            const color = _state.val?.toString().substring(1) || '000000';
            // replace blue component
            const out = color.substring(0, 4) + blue + color.substring(6, 10);
            await this.adapter.setStateAsync(idAlive, `#${out}`, false);
            this.setColor(channelId, out);
            return;
        }
        if (stateId?.match(/RGB_POWER\d?/)) {
            // set ww component
            const rgbpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
            const idAlive = `${deviceDesc}.Color`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state || typeof _state.val !== 'string') {
                this.adapter.log.info(`Invalid state color for ${idAlive}, correcting value to #000000`);
                await this.adapter.setStateAsync(idAlive, '#000000', false);
                return;
            }
            const color = _state.val.substring(1);
            let rgb = '000000';
            if (rgbpow) {
                rgb = 'FFFFFF';
            }
            // replace rgb component
            let out = rgb + color.substring(6, 10);
            if (rgbpow && exorWhiteLeds) {
                //this.adapter.log.info('reset white');
                out = `${rgb}0000`;
                let idAlive = `${deviceDesc}.WW_POWER`;
                await this.adapter.setStateAsync(idAlive, false, false);
                idAlive = `${deviceDesc}.WW`;
                await this.adapter.setStateAsync(idAlive, 0, false);
                idAlive = `${deviceDesc}.CW_POWER`;
                await this.adapter.setStateAsync(idAlive, false, false);
                idAlive = `${deviceDesc}.CW`;
                await this.adapter.setStateAsync(idAlive, 0, false);
            }
            this.setColor(channelId, out);
            await this.adapter.setStateAsync(idAlive, `#${out}`, false);
            if (rgbpow) {
                this.setPower(channelId, true);
            }
            // if led_mode&1, exor white leds
            return;
        }
        if (hueCalc && stateId?.match(/Hue\d?/)) {
            // calc hue + saturation params to rgb
            let hue = state.val;
            if (hue > 359) {
                hue = 359;
            }
            // recalc color by hue
            const idAlive = `${deviceDesc}.Dimmer`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state) {
                const dim = 100;
                await this.adapter.setStateAsync(idAlive, dim, true);
                //this.adapter.log.warn('ill state Dimmer');
            }
            else {
                const dim = _state.val;
                const idAlive = `${deviceDesc}.Saturation`;
                const __state = await this.adapter.getForeignStateAsync(idAlive);
                if (!__state) {
                    const sat = 100;
                    await this.adapter.setStateAsync(idAlive, sat, true);
                }
                else {
                    const sat = __state.val;
                    const rgb = hsvToRgb(hue, sat, dim);
                    const hexVal = componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
                    const idAlive = `${deviceDesc}.Color`;
                    await this.adapter.setStateAsync(idAlive, `#${hexVal}`, false);
                }
            }
            return;
        }
        if (hueCalc && stateId?.match(/Saturation\d?/)) {
            let sat = state.val;
            if (sat > 100) {
                sat = 100;
            }
            // recalc color by saturation
            const idAlive = `${deviceDesc}.Dimmer`;
            const _state = await this.adapter.getForeignStateAsync(idAlive);
            if (!_state) {
                const dim = 100;
                await this.adapter.setStateAsync(idAlive, dim, true);
                // this.adapter.log.warn('ill state Dimmer');
            }
            else {
                const dim = _state.val;
                const idAlive = `${deviceDesc}.Hue`;
                const __state = await this.adapter.getForeignStateAsync(idAlive);
                if (!__state) {
                    const hue = 100;
                    await this.adapter.setStateAsync(idAlive, hue, true);
                }
                else {
                    const hue = __state.val;
                    const rgb = hsvToRgb(hue, sat, dim);
                    const hexVal = componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
                    const idAlive = `${deviceDesc}.Color`;
                    await this.adapter.setStateAsync(idAlive, `#${hexVal}`, false);
                }
            }
            return;
        }
        // get color attributes to check other ledstripe vars
        const idAlive = `${deviceDesc}.Color`;
        const obj = await this.adapter.getForeignObjectAsync(idAlive);
        if (!obj) {
            // no color object
            this.adapter.log.warn(`Unknown object: ${id}: ${JSON.stringify(state)}`);
        }
        else {
            const role = obj.common.role;
            //if (role='level.color.rgb') return;
            let wwindex;
            if (role === 'level.color.rgbww') {
                wwindex = 6;
            }
            else {
                wwindex = 8;
            }
            if (stateId?.match(/WW_POWER\d?/)) {
                // set ww component
                const wwpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
                let idAlive = `${deviceDesc}.Color`;
                const _state = await this.adapter.getForeignStateAsync(idAlive);
                if (!_state) {
                    this.adapter.log.warn('ill state color');
                    return;
                }
                const color = _state.val?.toString().substring(1) || '000000';
                let ww = '00';
                if (wwpow) {
                    ww = 'FF';
                }
                // replace ww component
                let out = color.substring(0, wwindex) + ww;
                if (wwpow && exorWhiteLeds) {
                    //this.adapter.log.info('reset white');
                    out = `000000${ww}`;
                    const idAlive = `${deviceDesc}.RGB_POWER`;
                    await this.adapter.setStateAsync(idAlive, false, false);
                }
                idAlive = `${deviceDesc}.Color`;
                await this.adapter.setStateAsync(idAlive, `#${out}`, false);
                this.setColor(channelId, out);
                // set ww channel
                idAlive = `${deviceDesc}.WW`;
                await this.adapter.setStateAsync(idAlive, (100 * parseInt(out.substring(6, 8), 16)) / 255, true);
                // in case POWER is off, switch it on
                wwpow && this.setPower(channelId, true);
                return;
            }
            if (stateId?.match(/CW_POWER\d?/)) {
                // set ww component
                const cwpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
                let idAlive = `${deviceDesc}.Color`;
                const _state = await this.adapter.getForeignStateAsync(idAlive);
                if (!_state) {
                    this.adapter.log.warn('ill state color');
                    return;
                }
                const color = _state.val?.toString().substring(1) || '000000';
                let cw = '00';
                if (cwpow) {
                    cw = 'FF';
                }
                // replace cw component
                let out = color.substring(0, 6) + cw + color.substring(8, 10);
                if (cwpow && exorWhiteLeds) {
                    //this.adapter.log.info('reset white');
                    out = `000000${cw}${color.substring(8, 10)}`;
                    const idAlive = `${deviceDesc}.RGB_POWER`;
                    await this.adapter.setStateAsync(idAlive, false, false);
                }
                idAlive = `${deviceDesc}.Color`;
                await this.adapter.setStateAsync(idAlive, `#${out}`, false);
                this.setColor(channelId, out);
                // set cw channel
                idAlive = `${deviceDesc}.CW`;
                await this.adapter.setStateAsync(idAlive, (100 * parseInt(out.substring(6, 8), 16)) / 255, true);
                // in case POWER is off, switch it on
                if (cwpow) {
                    const idAlive = `${deviceDesc}.POWER`;
                    await this.adapter.setStateAsync(idAlive, true, false);
                }
                return;
            }
            if (stateId?.match(/WW\d?/)) {
                // set ww component
                const ww = toPaddedHexString(Math.floor((255 * state.val) / 100), 2);
                const idAlive = `${deviceDesc}.Color`;
                const _state = await this.adapter.getForeignStateAsync(idAlive);
                if (!_state) {
                    await this.adapter.setStateAsync(idAlive, '#000000', false);
                    return;
                }
                const color = _state.val?.toString().substring(1) || '000000';
                // replace ww component
                const out = color.substring(0, wwindex) + ww;
                this.setColor(channelId, out);
                return;
            }
            if (stateId?.match(/CW\d?/)) {
                // set ww component
                const cw = toPaddedHexString(Math.floor((255 * state.val) / 100), 2);
                const idAlive = `${deviceDesc}.Color`;
                const _state = await this.adapter.getForeignStateAsync(idAlive);
                if (!_state) {
                    await this.adapter.setStateAsync(idAlive, '#000000', false);
                    return;
                }
                const color = _state.val?.toString().substring(1) || '000000';
                // replace cw component
                const out = color.substring(0, 6) + cw + color.substring(8, 10);
                this.setColor(channelId, out);
            }
        }
    }
    async onStateChange(id, state) {
        this.adapter.log.debug(`onStateChange ${id}: ${JSON.stringify(state)}`);
        if (this.server && state && !state.ack) {
            // find client.id
            const parts = id.split('.');
            const stateId = parts.pop() || '';
            const channelId = parts.splice(2, parts.length).join('.');
            // Check if this is a Zigbee device state change
            // Pattern: ZbReceived_DEVICEID_ATTRIBUTE (e.g., ZbReceived_0x0856_Power)
            const zbMatch = stateId.match(/^ZbReceived_([^_]+)_(Power|Dimmer)$/);
            if (zbMatch && this.clients[this.mappingClients[channelId]]) {
                const deviceId = zbMatch[1];
                const attribute = zbMatch[2];
                let zbValue;
                // Convert values for Zigbee commands
                if (attribute === 'Power') {
                    zbValue = state.val ? '1' : '0';
                }
                else if (attribute === 'Dimmer') {
                    zbValue = state.val;
                }
                this.adapter.log.debug(`Sending ZbSend command for device ${deviceId}: ${attribute}=${zbValue}`);
                this.setZbSendCommand(this.mappingClients[channelId], deviceId, attribute, zbValue);
                return;
            }
            if (this.clients[this.mappingClients[channelId]]) {
                // check for special led-stripe vars
                if (!this.specVars.includes(stateId)) {
                    // other objects
                    const obj = await this.adapter.getObjectAsync(id);
                    if (!obj) {
                        this.adapter.log.warn(`Invalid object ${id}`);
                    }
                    else {
                        const type = obj.common.type;
                        switch (type) {
                            case 'boolean':
                                this.setStateImmediate(this.mappingClients[channelId], stateId, state.val ? 'ON' : 'OFF');
                                break;
                            case 'number':
                                this.setStateImmediate(this.mappingClients[channelId], stateId, state.val === null ? '' : state.val.toString());
                                break;
                            case 'string':
                                this.setStateImmediate(this.mappingClients[channelId], stateId, state.val === null ? '' : state.val.toString());
                                break;
                        }
                    }
                }
                else if (state.val !== null) {
                    await this.onStateChangedColors(id, state, channelId, stateId);
                }
            }
            else {
                //Client:"DVES_96ABFA : MagicHome" not connected => State: sonoff.0.myState - Value: 0, ack: false, time stamp: 1520369614189, last changed: 1520369614189
                // if (server && state && !state.ack) {
                // server = false
                // or state = false
                // or state.ack = true
                // or clients[channelId] = false
                if (!this.config.ignoreNotConnectedWarnings) {
                    this.adapter.log.info(`Client "${channelId}" not connected`);
                }
                /*
                 if (!clients[channelId]) {
                      var idAlive='sonoff.0.'+channelId+'.INFO.IPAddress';
                      this.adapter.getForeignState(idAlive, function (err, state) {
                         if (!state) {
                             this.adapter.log.warn('Client "' + channelId + '" could not get ip adress');
                         } else {
                              var ip=state.val;
                              this.adapter.log.warn('Clients ip "' + ip);

                              request('http://'+ip+'/cm?cmnd=Restart 1', function(error, response, body) {
                                     if (error || response.statusCode !== 200) {
                                      log('Fehler beim Neustart von Sonoff: ' + channelId + ' (StatusCode = ' + response.statusCode + ')');
                                     }
                              });
                          }
                      });
                  }*/
            }
        }
    }
    async processTasks(callback) {
        if (callback) {
            this.taskCallbacks.push(callback);
        }
        if (!this.tasks?.length) {
            const doCallbacks = this.taskCallbacks;
            this.taskCallbacks = [];
            doCallbacks.forEach(cb => typeof cb === 'function' && cb());
            return;
        }
        const task = this.tasks[0];
        this.adapter.log.debug(`process task: ${JSON.stringify(task)}`);
        if (task.type === 'addObject') {
            if (!this.cacheAddedObjects[task.id]) {
                this.cacheAddedObjects[task.id] = true;
                const obj = await this.adapter.getForeignObjectAsync(task.id);
                if (!obj?.common) {
                    try {
                        await this.adapter.setForeignObjectAsync(task.id, task.data);
                        this.adapter.log.info(`New object created: ${task.id}`);
                    }
                    catch (err) {
                        this.adapter.log.warn(`New object creation error: ${err.message}`);
                    }
                }
                else if (obj.common.type !== task.data.common.type ||
                    task.storeMap !== undefined) {
                    obj.common.type = task.data.common.type;
                    try {
                        await this.adapter.setForeignObjectAsync(task.id, obj);
                        this.adapter.log.info(`Object updated: ${task.id}`);
                    }
                    catch (err) {
                        this.adapter.log.warn(`Object update error: ${err.message}`);
                    }
                }
            }
        }
        else if (task.type === 'extendObject') {
            await this.adapter.extendObjectAsync(task.id, task.data);
        }
        else if (task.type === 'deleteObject') {
            await this.adapter.delForeignObjectAsync(task.id);
        }
        else {
            this.adapter.log.error(`Unknown task name: ${JSON.stringify(task)}`);
        }
        if (task.setState) {
            await this._setState(task.id, task.setValue);
        }
        this.tasks.shift();
        setImmediate(() => this.processTasks());
    }
    createClient(client, callback) {
        // mqtt.0.cmnd.sonoff.POWER
        // mqtt.0.stat.sonoff.POWER
        const isStart = !this.tasks.length;
        const id = `${this.adapter.namespace}.${client.iobId}`;
        const obj = {
            _id: id,
            common: {
                name: client.id,
                desc: '',
            },
            native: {
                clientId: client.id,
            },
            type: 'channel',
        };
        this.tasks.push({ type: 'addObject', id: obj._id, data: obj });
        const stateObj = {
            _id: `${id}.alive`,
            common: {
                type: 'boolean',
                role: 'indicator.reachable',
                read: true,
                write: false,
                name: `${client.id} alive`,
            },
            native: {},
            type: 'state',
        };
        this.tasks.push({ type: 'addObject', id: obj._id, data: stateObj });
        if (isStart) {
            this.processTasks(callback).catch(err => this.adapter.log.error(err));
        }
        else {
            typeof callback === 'function' && callback();
        }
    }
    async updateClients() {
        const clientIds = [];
        if (this.clients) {
            for (const id in this.clients) {
                const oid = `info.clients.${id.replace(/[.\s]+/g, '_').replace(FORBIDDEN_CHARS, '_')}`;
                clientIds.push(oid);
                const clientObj = await this.adapter.getObjectAsync(oid);
                if (!clientObj?.native) {
                    await this.adapter.setObjectAsync(oid, {
                        type: 'state',
                        common: {
                            name: id,
                            role: 'indicator.reachable',
                            type: 'boolean',
                            read: true,
                            write: false,
                        },
                        native: {
                            ip: this.clients[id].stream.remoteAddress,
                            port: this.clients[id].stream.remotePort,
                        },
                    });
                }
                else {
                    if (this.clients[id] &&
                        (clientObj.native.port !== this.clients[id].stream.remotePort ||
                            clientObj.native.ip !== this.clients[id].stream.remoteAddress)) {
                        clientObj.native.port = this.clients[id].stream.remotePort;
                        clientObj.native.ip = this.clients[id].stream.remoteAddress;
                        await this.adapter.setObjectAsync(clientObj._id, clientObj);
                    }
                }
                await this.adapter.setStateAsync(oid, true, true);
            }
        }
        // read all other states and set alive to false
        const allStates = await this.adapter.getStatesAsync('info.clients.*');
        for (const id in allStates) {
            if (!clientIds.includes(id.replace(`${this.adapter.namespace}.`, ''))) {
                await this.adapter.setStateAsync(id, { val: false, ack: true });
            }
        }
        let text = '';
        if (this.clients) {
            for (const id in this.clients) {
                text += `${text ? ',' : ''}${id}`;
            }
        }
        await this.adapter.setStateAsync('info.connection', text, true);
    }
    async updateAlive(client, alive) {
        const idAlive = `${this.adapter.namespace}.${client.iobId}.alive`;
        const state = await this.adapter.getForeignStateAsync(idAlive);
        if (!state || state.val !== alive) {
            await this.adapter.setForeignStateAsync(idAlive, alive, true);
        }
    }
    sendState2Client(client, topic, state, qos, retain, cb) {
        if (typeof qos === 'function') {
            cb = qos;
            qos = undefined;
        }
        if (typeof retain === 'function') {
            cb = retain;
            retain = undefined;
        }
        this.adapter.log.debug(`Send to "${client.id}": ${topic} = ${state}`);
        client.publish({
            topic,
            payload: state === null ? 'null' : state.toString(),
            qos: qos,
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
        else {
            //return;
        }
    }
    addObject(typeKey, client, prefix, path) {
        // Extract the actual attribute name for the state ID construction
        const attr = typeKey.includes('_') && path.length > 0 ? typeKey.split('_').pop() || '' : typeKey;
        const replaceAttr = datapoints_1.default[typeKey].replace || attr;
        const id = `${this.adapter.namespace}.${client.iobId}.${prefix ? `${prefix}.` : ''}${path.length ? `${path.join('_')}_` : ''}${replaceAttr.replace(FORBIDDEN_CHARS, '_')}`;
        return {
            type: 'addObject',
            id,
            data: {
                _id: id,
                common: {
                    name: `${client.id} ${prefix ? `${prefix} ` : ''}${path.length ? `${path.join(' ')} ` : ''} ${replaceAttr}`,
                    ...datapoints_1.default[typeKey],
                },
                native: {},
                type: 'state',
            },
        };
    }
    async syncPowerState(powerId, val) {
        if (!this.cachePowerObjects[powerId]) {
            const exists = await this.adapter.getForeignObjectAsync(powerId);
            if (exists) {
                this.cachePowerObjects[powerId] = true;
            }
        }
        if (this.cachePowerObjects[powerId]) {
            const state = await this.adapter.getForeignStateAsync(powerId);
            if (!state || state.val != val) {
                this.adapter.log.debug(`Sync .STATE.POWER to .POWER: ${powerId}`);
                this.adapter.setForeignState(powerId, val, true);
            }
        }
    }
    checkData(client, topic, prefix, data, unit, path) {
        if (!data || typeof data !== 'object') {
            return;
        }
        const ledModeReadColorsID = `${this.adapter.namespace}.${client.iobId}.modeReadColors`;
        if (this.cachedReadColors[ledModeReadColorsID] === undefined) {
            void this.adapter.getForeignState(ledModeReadColorsID, (err, state) => {
                this.cachedReadColors[ledModeReadColorsID] = !!state?.val;
                setImmediate(() => this.checkData(client, topic, prefix, data, unit, path));
            });
            return;
        }
        path ||= [];
        prefix ||= '';
        // Extract pressure and temperature units if available at this level for nested data
        const pressureUnit = data.PressureUnit || (unit && typeof unit === 'object' ? unit.pressureUnit : undefined);
        const tempUnit = data.TempUnit || (unit && typeof unit === 'object' ? unit.tempUnit : undefined);
        for (const attr in data) {
            if (!Object.prototype.hasOwnProperty.call(data, attr)) {
                this.adapter.log.warn(`[${client.id}] attr error: ${attr}${data[attr]}`);
                continue;
            }
            // Skip unit fields - they are used for dynamic unit override, not as states
            if (attr === 'TempUnit' || attr === 'PressureUnit') {
                continue;
            }
            if (typeof data[attr] === 'object') {
                // check for arrays
                if (datapoints_1.default[attr]) {
                    if (datapoints_1.default[attr].type === 'array') {
                        // transform to an array of attributes
                        for (let i = 1; i <= 10; i++) {
                            const val = data[attr][i - 1];
                            if (typeof val === 'undefined') {
                                break;
                            }
                            // define a new object
                            const replaceAttr = attr.replace(FORBIDDEN_CHARS, '_') + i.toString();
                            const id = `${this.adapter.namespace}.${client.iobId}.${prefix ? `${prefix}.` : ''}${path.length ? `${path.join('_')}_` : ''}${replaceAttr}`;
                            const obj = {
                                type: 'addObject',
                                id,
                                data: {
                                    _id: id,
                                    common: {
                                        name: `${client.id} ${prefix ? `${prefix} ` : ''}${path.length ? `${path.join(' ')} ` : ''} ${replaceAttr}`,
                                        ...datapoints_1.default[attr],
                                        type: typeof val,
                                    },
                                    native: {},
                                    type: 'state',
                                },
                            };
                            if (!['number', 'string', 'boolean'].includes(obj.data.common.type)) {
                                obj.data.common.type = 'string';
                            }
                            this.updateState(obj, val);
                        }
                    }
                    else {
                        let nPath = [...path];
                        nPath.push(attr.replace(FORBIDDEN_CHARS, '_'));
                        const nestedUnits = pressureUnit || tempUnit ? { pressureUnit, tempUnit } : unit;
                        this.checkData(client, topic, prefix, data[attr], nestedUnits, nPath);
                        nPath = undefined;
                    }
                }
                else {
                    let nPath = [...path];
                    nPath.push(attr.replace(FORBIDDEN_CHARS, '_'));
                    const nestedUnits = pressureUnit || tempUnit ? { pressureUnit, tempUnit } : unit;
                    if (this.config.OBJ_TREE) {
                        this.checkData(client, topic, `${prefix}.${nPath.join('.')}`, data[attr], nestedUnits);
                    }
                    else {
                        this.checkData(client, topic, prefix, data[attr], nestedUnits, nPath);
                    }
                    nPath = undefined;
                }
            }
            else if (datapoints_1.default[attr] || (path.length > 0 && datapoints_1.default[`${path.join('_')}_${attr}`])) {
                let allowReadColors;
                // Check for path-based type definition first, then fallback to simple attr type
                const typeKey = path.length > 0 && datapoints_1.default[`${path.join('_')}_${attr}`] ? `${path.join('_')}_${attr}` : attr;
                // create object
                const obj = this.addObject(typeKey, client, prefix, path);
                const replaceAttr = datapoints_1.default[typeKey].replace || attr;
                if (obj.storeMap) {
                    client._map[replaceAttr] = topic.replace(/^\w+\//, 'cmnd/').replace(/\/\w+$/, `/${replaceAttr}`);
                }
                // handle dynamic pressure unit override
                if (attr === 'Pressure' && pressureUnit && typeof pressureUnit === 'string') {
                    obj.data.common.unit = pressureUnit;
                }
                // handle dynamic temperature unit override
                if (attr === 'Temperature' && tempUnit && typeof tempUnit === 'string') {
                    obj.data.common.unit = tempUnit;
                }
                // adaptions for magichome tasmota
                if (attr === 'Color') {
                    // read vars
                    allowReadColors = this.cachedReadColors[ledModeReadColorsID]; // allow for color read from MQTT (default off)
                    // if ledFlags bit 2, read color from tasmota, else ignore
                    if (data[attr].length === 10) {
                        obj.data.common.role = 'level.color.rgbcwww'; // RGB + cold white + white???
                    }
                    else if (data[attr].length === 8) {
                        obj.data.common.role = 'level.color.rgbww'; // RGB + White
                    }
                    else {
                        obj.data.common.role = 'level.color.rgb';
                    }
                    if (hueCalc) {
                        // Create LEDs modes if required
                        let xObj = this.addObject('modeReadColors', client, prefix, path);
                        this.updateState(xObj);
                        xObj = this.addObject('modeLedExor', client, prefix, path);
                        this.updateState(xObj);
                        xObj = this.addObject('Hue', client, prefix, path);
                        this.updateState(xObj);
                        xObj = this.addObject('Saturation', client, prefix, path);
                        this.updateState(xObj);
                        xObj = this.addObject('Red', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(0, 2), 16)) / 255 : undefined);
                        xObj = this.addObject('Green', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(2, 4), 16)) / 255 : undefined);
                        xObj = this.addObject('Blue', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(4, 6), 16)) / 255 : undefined);
                        xObj = this.addObject('RGB_POWER', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        let val = parseInt(data[attr].substring(0, 6), 16);
                        this.updateState(xObj, allowReadColors ? val > 0 : undefined);
                        if (obj.data.common.role === 'level.color.rgbww') {
                            // rgbww
                            xObj = this.addObject('WW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(6, 8), 16)) / 255 : undefined);
                            xObj = this.addObject('WW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            this.updateState(xObj, allowReadColors ? val > 0 : undefined);
                        }
                        else if (obj.data.common.role === 'level.color.rgbcwww') {
                            // rgbcwww
                            xObj = this.addObject('CW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(6, 8), 16)) / 255 : undefined);
                            xObj = this.addObject('CW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            this.updateState(xObj, allowReadColors ? val > 0 : undefined);
                            xObj = this.addObject('WW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            this.updateState(xObj, allowReadColors ? (100 * parseInt(data[attr].substring(8, 10), 16)) / 255 : undefined);
                            xObj = this.addObject('WW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            val = parseInt(data[attr].substring(8, 10), 16);
                            this.updateState(xObj, allowReadColors ? val > 0 : undefined);
                        }
                    }
                }
                let val;
                if (obj.data.common.type === 'number') {
                    val = parseFloat(data[attr]);
                }
                else if (obj.data.common.type === 'boolean') {
                    const _value = (data[attr] || '').toUpperCase();
                    val = _value === 'ON' || _value === 'TRUE' || _value === '1';
                }
                else {
                    if (attr === 'Color') {
                        // add # char
                        if (allowReadColors) {
                            val = `#${data[attr]}`;
                        }
                    }
                    else {
                        val = data[attr];
                    }
                }
                this.updateState(obj, val);
                // Special handling for Zigbee devices: create writable control states for Power and Dimmer
                if ((attr === 'Power' || attr === 'Dimmer') &&
                    prefix === 'SENSOR' &&
                    path.length >= 2 &&
                    path[0] === 'ZbReceived') {
                    // Extract device ID from path (e.g., ZbReceived_0x0856_Power -> 0x0856)
                    const deviceId = path[1];
                    // Create a writable control state for Zigbee devices
                    const controlObj = Object.assign({}, obj);
                    // Modify object properties for control state
                    if (attr === 'Power') {
                        // For Zigbee Power: boolean switch, not power consumption in watts
                        controlObj.data.common = {
                            type: 'boolean',
                            role: 'switch',
                            read: true,
                            write: true,
                            name: `${client.id} ${prefix ? `${prefix} ` : ''}${path.join(' ')} ${attr} Control`,
                        };
                        // Convert numeric power value (0/1) to boolean for control state
                        const controlVal = Boolean(val);
                        this.updateState(controlObj, controlVal);
                    }
                    else if (attr === 'Dimmer') {
                        // For Zigbee Dimmer: ensure it's writable
                        controlObj.data.common.write = true;
                        controlObj.data.common.name = `${client.id} ${prefix ? `${prefix} ` : ''}${path.join(' ')} ${attr} Control`;
                        this.updateState(controlObj, val);
                    }
                    this.adapter.log.debug(`Created Zigbee control state for device ${deviceId}: ${controlObj.id}`);
                }
                // Sync .STATE.POWER -> .POWER
                if (obj.id.includes('.STATE.POWER')) {
                    const powerId = obj.id.replace('.STATE.POWER', '.POWER');
                    this.syncPowerState(powerId, val).catch(err => this.adapter.log.error(`Cannot sync power states: ${err}`));
                }
            }
            else {
                // not in list, auto insert
                //if (client.id=='DVES_008ADB') {
                //	this.adapter.log.warn('[' + client.id + '] Received attr not in list: ' + attr + '' + data[attr]);
                //}
                // tele/sonoff/SENSOR  tele/sonoff/STATE => read only
                // stat/sonoff/RESULT => read,write
                const parts = topic.split('/');
                // auto generate objects
                if ((parts[0] === 'tele' &&
                    ((this.config.TELE_SENSOR && parts[2] === 'SENSOR') ||
                        (this.config.STAT_RESULT && parts[2] === 'RESULT') ||
                        (this.config.TELE_STATE && parts[2] === 'STATE') ||
                        (this.config.TELE_MARGINS && parts[2] === 'MARGINS'))) ||
                    (parts[0] === 'stat' && this.config.STAT_RESULT && parts[2] === 'RESULT')) {
                    let val = data[attr];
                    const replaceAttr = attr;
                    const attributes = {
                        role: 'value',
                        read: true,
                        write: false,
                        type: typeof val,
                        name: `${client.id} ${prefix ? `${prefix} ` : ''}${path.length ? `${path.join(' ')} ` : ''} ${replaceAttr}`,
                    };
                    if (parts[2] === 'RESULT') {
                        // control
                        attributes.write = true;
                        attributes.role = 'level';
                    }
                    if (!['number', 'string', 'boolean'].includes(attributes.type)) {
                        attributes.type = 'string';
                        val = (val || '').toString();
                    }
                    const id = `${this.adapter.namespace}.${client.iobId}.${prefix ? `${prefix}.` : ''}${path.length ? `${path.join('_')}_` : ''}${replaceAttr}`;
                    const obj = {
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: attributes,
                            native: {},
                            type: 'state',
                        },
                    };
                    obj.data.common.name =
                        `${client.id} ${prefix ? `${prefix} ` : ''}${path.length ? `${path.join(' ')} ` : ''} ${replaceAttr}`;
                    this.updateState(obj, val);
                    // Sync .STATE.POWER -> .POWER
                    if (obj.id.includes('.STATE.POWER')) {
                        const powerId = obj.id.replace('.STATE.POWER', '.POWER');
                        this.syncPowerState(powerId, val).catch(err => this.adapter.log.error(`Cannot sync power states: ${err}`));
                    }
                }
            }
        }
    }
    async receivedTopic(packet, client) {
        if (!packet) {
            this.adapter.log.warn(`Empty packet received: ${JSON.stringify(packet)}`);
            return;
        }
        // client.states ||= {};
        // client.states[packet.topic] = {
        //     message: packet.payload,
        //     retain: packet.retain,
        //     qos: packet.qos,
        // };
        // update alive state
        await this.updateAlive(client, true);
        if (client._will?.topic && packet.topic === client._will.topic) {
            client._will.payload = packet.payload;
            return;
        }
        let val = packet.payload.toString('utf8');
        this.adapter.log.debug(`Client [${client.id}] received: ${packet.topic} = ${val}`);
        /*
        this.adapter.getForeignState('system.this.adapter.sonoff.0.memRss', (err, state) => {
            this.adapter.log.info('mem: ' + state.val + ' MB');
            if (heapTest==0 || (heapTest==1 && state.val>37.5)) {
                heapTest+=1;
                heapdump.writeSnapshot('/opt/iobroker/' + Date.now() + '.heapsnapshot');
                this.adapter.log.info('Wrote snapshot: ');

                var filename='/opt/iobroker/' + Date.now() + '.heapsnapshot';
                heapdump.writeSnapshot((err,filename) => {
                    if (err) {
                        this.adapter.log.info('heap: ' + err);
                    } else {
                        this.adapter.log.info('Wrote snapshot: ' + filename);
                    }
                });

            }
        });
        */
        // [DVES_BD3B4D] Received: tele/sonoff2/STATE = {
        //      "Time":"2017-10-01T12:37:18",
        //      "Uptime":0,
        //      "Vcc":3.224,
        //      "POWER":"ON",
        //      "POWER1":"OFF",
        //      "POWER2":"ON"
        //      "Wifi":{
        //          "AP":1,
        //          "SSId":"FuckOff",
        //          "RSSI":62,
        //          "APMac":"E0:28:6D:EC:21:EA"
        //      }
        // }
        // [DVES_BD3B4D] Received: tele/sonoff2/SENSOR = {
        //      "Time":"2017-10-01T12:37:18",
        //      "Switch1":"ON",
        //      "DS18B20":{"Temperature":20.6},
        //      "TempUnit":"C"
        // }
        client._map ||= {};
        const parts = packet.topic.split('/');
        client._fallBackName ||= parts[1];
        let stateId = parts.pop() || '';
        // Handle OpenBeken topics with /get or /set suffix
        // e.g., devicename/led_enableAll/get -> stateId should be led_enableAll
        if ((stateId === 'get' || stateId === 'set') && parts.length > 0) {
            const possibleStateId = parts[parts.length - 1];
            if (possibleStateId && possibleStateId.startsWith('led_') && datapoints_1.default[possibleStateId]) {
                stateId = parts.pop() || ''; // Use led_enableAll instead of get/set
            }
        }
        if (stateId === 'LWT') {
            return;
        }
        if (val.includes('nan')) {
            val = val.replace(/:nan,/g, ':"NaN",').replace(/:nan}/g, ':"NaN"}').replace(/:nan]/g, ':"NaN"]');
        }
        if (stateId === 'RESULT') {
            // ignore: stat/Sonoff/RESULT = {"POWER":"ON"}
            // testserver.js reports error, so reject above cmd
            const str = val.replace(/\s+/g, '');
            if (str.startsWith('{"POWER":"ON"}')) {
                return;
            }
            if (str.startsWith('{"POWER":"OFF"}')) {
                return;
            }
            if (parts[0] === 'stat' || parts[0] === 'tele') {
                try {
                    if (this.config.OBJ_TREE) {
                        this.checkData(client, packet.topic, 'RESULT', JSON.parse(val));
                    }
                    else {
                        this.checkData(client, packet.topic, NO_PREFIX, JSON.parse(val));
                    }
                }
                catch (e) {
                    this.adapter.log.warn(`Client [${client.id}] cannot parse data "${stateId}": _${val}_ - ${e}`);
                }
            }
            return;
        }
        // tele/sonoff_4ch/STATE = {"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}
        // tele/sonoff/SENSOR    = {"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}
        // tele/sonoff5/SENSOR   = {"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}
        // tele/sonoff/SENSOR    = {"Time":"2018-02-23T17:36:59", "Analog0":298}
        if (parts[0] === 'tele' && stateId.match(/^(RESULT|STATE|SENSOR|WAKEUP)\d?$/)) {
            try {
                if (this.config.OBJ_TREE) {
                    if (stateId.match(/^(STATE)\d?$/)) {
                        this.checkData(client, packet.topic, 'STATE', JSON.parse(val));
                    }
                    else if (stateId.match(/^(SENSOR)\d?$/)) {
                        this.checkData(client, packet.topic, 'SENSOR', JSON.parse(val));
                    }
                    else if (stateId.match(/^(WAKEUP)\d?$/)) {
                        this.checkData(client, packet.topic, 'WAKEUP', JSON.parse(val));
                    }
                    else if (stateId.match(/^(RESULT)\d?$/)) {
                        this.checkData(client, packet.topic, 'RESULT', JSON.parse(val));
                    }
                }
                else {
                    this.checkData(client, packet.topic, NO_PREFIX, JSON.parse(val));
                    //this.adapter.log.warn('log sensor parse"' + stateId + '": _' + val);
                }
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data"${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (parts[0] === 'tele' && stateId.match(/^INFO\d?$/)) {
            // tele/SonoffPOW/INFO1 = {"Module":"Sonoff Pow", "Version":"5.8.0", "FallbackTopic":"SonoffPOW", "GroupTopic":"sonoffs"}
            // tele/SonoffPOW/INFO2 = {"WebServerMode":"Admin", "Hostname":"Sonoffpow", "IPAddress":"192.168.2.182"}
            // tele/SonoffPOW/INFO3 = {"RestartReason":"Software/System restart"}
            try {
                this.checkData(client, packet.topic, 'INFO', JSON.parse(val));
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data"${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (parts[0] === 'tele' && stateId.match(/^(ENERGY)\d?$/)) {
            // tele/sonoff_4ch/ENERGY = {"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}
            try {
                this.checkData(client, packet.topic, 'ENERGY', JSON.parse(val));
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data"${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (parts[0] === 'tele' && stateId.match(/^(MARGINS)\d?$/)) {
            // tele/sonoffPOW/MARGINS = {"Time":"2020-04-23T10:15:00","PowerLow":100,"PowerHigh":2000,"PowerDelta":50}
            try {
                this.checkData(client, packet.topic, 'MARGINS', JSON.parse(val));
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data"${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (datapoints_1.default[stateId]) {
            // /ESP_BOX/BM280/Pressure = 1010.09
            // /ESP_BOX/BM280/Humidity = 42.39
            // /ESP_BOX/BM280/Temperature = 25.86
            // /ESP_BOX/BM280/Approx. Altitude = 24
            // cmnd/sonoff/POWER
            // stat/sonoff/POWER
            if (datapoints_1.default[stateId]) {
                const id = `${this.adapter.namespace}.${client.iobId}.${stateId.replace(/[-.+\s]+/g, '_').replace(FORBIDDEN_CHARS, '_')}`;
                const obj = {
                    type: 'addObject',
                    id,
                    data: {
                        _id: id,
                        common: {
                            name: `${client.id} ${stateId}`,
                            ...datapoints_1.default[stateId],
                        },
                        native: {},
                        type: 'state',
                    },
                };
                // push only new objects
                this.updateState(obj, async () => {
                    if (obj.data.common.type === 'number') {
                        await this.adapter.setStateAsync(id, parseFloat(val), true);
                    }
                    else if (obj.data.common.type === 'boolean') {
                        if (val === 'ON' || val === '1' || val === 'true' || val === 'on') {
                            await this.adapter.setStateAsync(id, true, true);
                        }
                        else if (val === 'OFF' || val === '0' || val === 'false' || val === 'off') {
                            await this.adapter.setStateAsync(id, false, true);
                        }
                    }
                    else {
                        await this.adapter.setStateAsync(id, val, true);
                    }
                    // Store topic mapping for state changes
                    // For OpenBeken topics like devicename/led_enableAll or devicename/led_enableAll/get
                    // we need to map to devicename/led_enableAll/set for writing
                    let mappedTopic = packet.topic;
                    if (mappedTopic.endsWith('/get')) {
                        // OpenBeken: devicename/led_enableAll/get -> devicename/led_enableAll/set
                        mappedTopic = mappedTopic.replace(/\/get$/, '/set');
                    }
                    else if (stateId.startsWith('led_') &&
                        parts[0] !== 'cmnd' &&
                        parts[0] !== 'stat' &&
                        parts[0] !== 'tele') {
                        // OpenBeken without suffix: devicename/led_enableAll -> devicename/led_enableAll/set
                        mappedTopic = `${packet.topic}/set`;
                    }
                    client._map[stateId] = mappedTopic;
                });
            }
            else {
                this.adapter.log.debug(`Cannot process: ${packet.topic}`);
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