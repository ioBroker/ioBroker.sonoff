"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORBIDDEN_CHARS = void 0;
const datapoints_1 = __importDefault(require("./datapoints"));
const hueCalc = true;
exports.FORBIDDEN_CHARS = /[\]\\[*,;'"`<>\\?]/g;
const NO_PREFIX = '';
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
class MQTTBase {
    clients = {};
    tasks = [];
    taskCallbacks = [];
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
        this.adapter = adapter;
        this.config = adapter.config;
        this.config.defaultQoS = parseInt(this.config.defaultQoS, 10) || 0;
    }
    setColor(channelId, val) {
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
        if (state && !state.ack) {
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
                if (!this.config.ignoreNotConnectedWarnings) {
                    this.adapter.log.info(`Client "${channelId}" not connected`);
                }
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
        this.tasks.push({ id: obj._id, data: obj });
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
        this.tasks.push({ id: stateObj._id, data: stateObj });
        if (isStart) {
            this.processTasks(callback).catch(err => this.adapter.log.error(err));
        }
        else {
            typeof callback === 'function' && callback();
        }
    }
    async updateClients() {
        const clientIds = [];
        const clientNames = [];
        if (this.clients) {
            for (const id in this.clients) {
                const oid = `info.clients.${id.replace(/[.\s]+/g, '_').replace(exports.FORBIDDEN_CHARS, '_')}`;
                clientIds.push(oid);
                clientNames.push(id);
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
        await this.updateConnectionState(clientNames);
    }
    /**
     * Update info.connection: the server writes the list of the connected clients there,
     * the bridge the URL of the external broker
     */
    async updateConnectionState(clientNames) {
        await this.adapter.setStateAsync('info.connection', clientNames.join(','), true);
    }
    async updateAlive(client, alive) {
        const idAlive = `${this.adapter.namespace}.${client.iobId}.alive`;
        const state = await this.adapter.getForeignStateAsync(idAlive);
        if (!state || state.val !== alive) {
            await this.adapter.setForeignStateAsync(idAlive, alive, true);
        }
    }
    addObject(typeKey, client, prefix, path) {
        // Extract the actual attribute name for the state ID construction
        const attr = typeKey.includes('_') && path.length > 0 ? typeKey.split('_').pop() || '' : typeKey;
        const replaceAttr = datapoints_1.default[typeKey].replace || attr;
        const id = `${this.adapter.namespace}.${client.iobId}.${prefix ? `${prefix}.` : ''}${path.length ? `${path.join('_')}_` : ''}${replaceAttr.replace(exports.FORBIDDEN_CHARS, '_')}`;
        return {
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
                            const replaceAttr = attr.replace(exports.FORBIDDEN_CHARS, '_') + i.toString();
                            const id = `${this.adapter.namespace}.${client.iobId}.${prefix ? `${prefix}.` : ''}${path.length ? `${path.join('_')}_` : ''}${replaceAttr}`;
                            const obj = {
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
                        nPath.push(attr.replace(exports.FORBIDDEN_CHARS, '_'));
                        const nestedUnits = pressureUnit || tempUnit ? { pressureUnit, tempUnit } : unit;
                        this.checkData(client, topic, prefix, data[attr], nestedUnits, nPath);
                        nPath = undefined;
                    }
                }
                else {
                    let nPath = [...path];
                    nPath.push(attr.replace(exports.FORBIDDEN_CHARS, '_'));
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
                if (datapoints_1.default[typeKey].storeMap) {
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
                    this.syncPowerState(powerId, val ?? null).catch(err => this.adapter.log.error(`Cannot sync power states: ${err}`));
                }
            }
            else {
                // not in list, auto insert
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
                        id,
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
                        this.syncPowerState(powerId, val ?? null).catch(err => this.adapter.log.error(`Cannot sync power states: ${err}`));
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
        // Last will topic: "Online" is published by the device itself, "Offline" by the broker
        // if the device is gone. With the built-in broker the connection state is used instead,
        // but in bridge mode this is the only way to detect that a device disappeared.
        if (packet.topic.endsWith('/LWT')) {
            const lwt = packet.payload.toString('utf8').trim().toLowerCase();
            this.adapter.log.debug(`Client [${client.id}] received: ${packet.topic} = ${lwt}`);
            await this.updateAlive(client, lwt !== 'offline');
            return;
        }
        // update alive state
        await this.updateAlive(client, true);
        if (client._will?.topic && packet.topic === client._will.topic) {
            client._will.payload = packet.payload;
            return;
        }
        let val = packet.payload.toString('utf8');
        this.adapter.log.debug(`Client [${client.id}] received: ${packet.topic} = ${val}`);
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
        else if (parts[0] === 'stat' && stateId === 'STATUS10') {
            // stat/device/STATUS10 = {"StatusSNS":{"Time":"...","Switch2":"ON","Switch3":"OFF",...}}
            try {
                const data = JSON.parse(val);
                if (data.StatusSNS && typeof data.StatusSNS === 'object') {
                    this.checkData(client, packet.topic, NO_PREFIX, data.StatusSNS);
                }
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data "${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (parts[0] === 'stat' && stateId === 'STATUS5') {
            // stat/device/STATUS5 = {"StatusNET":{"Hostname":"...","IPAddress":"...",...}}
            try {
                const data = JSON.parse(val);
                if (data.StatusNET && typeof data.StatusNET === 'object') {
                    this.checkData(client, packet.topic, 'INFO', data.StatusNET);
                }
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data "${stateId}": _${val}_ - ${e}`);
            }
        }
        else if (parts[0] === 'stat' && stateId === 'STATUS2') {
            // stat/device/STATUS2 = {"StatusFWR":{"Version":"...","Hardware":"...",...}}
            try {
                const data = JSON.parse(val);
                if (data.StatusFWR && typeof data.StatusFWR === 'object') {
                    this.checkData(client, packet.topic, 'INFO', data.StatusFWR);
                }
            }
            catch (e) {
                this.adapter.log.warn(`Client [${client.id}] cannot parse data "${stateId}": _${val}_ - ${e}`);
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
                const id = `${this.adapter.namespace}.${client.iobId}.${stateId.replace(/[-.+\s]+/g, '_').replace(exports.FORBIDDEN_CHARS, '_')}`;
                const obj = {
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
                    let mappedTopic = packet.topic;
                    if (mappedTopic.endsWith('/get')) {
                        // OpenBeken: devicename/led_enableAll/get -> devicename/led_enableAll/set
                        mappedTopic = mappedTopic.replace(/\/get$/, '/set');
                    }
                    else if (parts[0] === 'stat' || parts[0] === 'tele') {
                        // Convert stat/tele topics to cmnd for outgoing commands.
                        // Only the first and the last part are replaced, so nested full topics
                        // like tele/house/floor/device/POWER stay intact
                        mappedTopic = mappedTopic.replace(/^\w+\//, 'cmnd/').replace(/\/[^/]+$/, `/${stateId}`);
                    }
                    else if (stateId.startsWith('led_')) {
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
}
exports.default = MQTTBase;
//# sourceMappingURL=mqttBase.js.map