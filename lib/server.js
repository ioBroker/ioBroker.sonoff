/* jshint -W097 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const mqtt    = require('mqtt-connection');
const net     = require('net');
const types   = require('./datapoints');
//const memwatch = require('memwatch-next');
//const heapdump = require('heapdump');
const hueCalc = true;
//var heapTest = 0;
const FORBIDDEN_CHARS = /[\]\[*,;'"`<>\\?]/g;
const mappingClients = {};
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
    let r, g, b;
    let i;
    let f, p, q, t;

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
        return [
            Math.round(r * 255),
            Math.round(g * 255),
            Math.round(b * 255)
        ];
    }

    h /= 60; // sector 0 to 5
    i = Math.floor(h);
    f = h - i; // factorial part of h
    p = v * (1 - s);
    q = v * (1 - s * f);
    t = v * (1 - s * (1 - f));

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

    return [
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255)
    ];
}

function componentToHex(c) {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
}

function toPaddedHexString(num, len) {
    if (len === 2) {
        if (num > 255) {
            num = 255;
        }
    }
    const str = num.toString(16);
    return '0'.repeat(len - str.length) + str;
}

function MQTTServer(adapter) {
    if (!(this instanceof MQTTServer)) {
        return new MQTTServer(adapter);
    }

    const NO_PREFIX = '';

    let server = new net.Server();
    const clients = {};
    const tasks = [];
    let messageId = 1;
    let persistentSessions = {};
    let resending   = false;
    let resendTimer = null;

    const cacheAddedObjects = {};
    const cachedModeExor = {};
    const cachedReadColors = {};

    this.destroy = cb => {
        if (resendTimer) {
            clearInterval(resendTimer);
            resendTimer = null;
        }

        if (server) {
            let cnt = 0;
            Object.keys(clients).forEach(id => {
                cnt++;
                adapter.setForeignState(adapter.namespace + '.' + clients[id].iobId + '.alive', false, true, () => {
                    if (!--cnt) {
                        // to release all resources
                        server.close(() => cb && cb());
                        server = null;
                    }
                });
            });

            if (!cnt) {
                // to release all resources
                server.close(() => cb && cb());
                server = null;
            }
        } else {
            cb && cb();
        }
    };

/*
    memwatch.on('leak', (info) => {
        //console.error('Memory leak detected:\n', info);
        adapter.log.info('Memory leak detected:\n', info);
        var filename='/opt/iobroker/dumps/' + Date.now() + '.heapsnapshot';
        heapdump.writeSnapshot((err,filename) => {
           if (err) {
               console.error(err);
           }
           else console.error('Wrote snapshot: ' + filename);
        });
    });
 */
/*
    memwatch.on('stats', function(stats) {
        adapter.log.info("stats:",stats);
    });
*/

    function setColor(channelId, val) {
        //adapter.log.info('color write: '+ val);
        const stateId = 'Color';
        if (clients[channelId]._map && clients[channelId]._map[stateId]) {
            setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || 'cmnd/sonoff/Color', val, adapter.config.defaultQoS);
        } else if (clients[channelId]._fallBackName) {
            setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val, adapter.config.defaultQoS);
        } else {
            adapter.log.warn('Unknown mapping for "' + stateId + '"');
        }
    }

    function setPower(channelId, val) {
        const stateId = 'POWER';
        if (val === '' || val === null || val === undefined) {
            return adapter.log.debug('Empty power was ignored');
        }
        if (clients[channelId]._map && clients[channelId]._map[stateId]) {
            setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || 'cmnd/sonoff/POWER', val ? 'ON' : 'OFF', adapter.config.defaultQoS);
        } else if (clients[channelId]._fallBackName) {
            setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val, adapter.config.defaultQoS);
        } else {
            adapter.log.warn('Unknown mapping for "' + stateId + '"');
        }
    }

    function setStateImmediate(channelId,stateId,val) {
        if (clients[channelId]._map && clients[channelId]._map[stateId]) {
            setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || ('cmnd/sonoff/' + stateId), val, adapter.config.defaultQoS);
        } else if (clients[channelId]._fallBackName) {
            setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val, adapter.config.defaultQoS);
        } else {
            adapter.log.warn('Unknown mapping for "' + stateId + '"');
        }
    }

    function _setState(id, val) {
        adapter.setForeignState(id, val, true, () =>
            setImmediate(processTasks));
    }

    function updateState(task, val) {
        if (val !== undefined) {
            task.cb    = _setState;
            task.cbArg = val;
        }
        tasks.push(task);

        if (tasks.length === 1) {
            setImmediate(processTasks);
        }
	}

    const specVars = ['Red', 'Green', 'Blue', 'WW', 'CW', 'Color', 'RGB_POWER', 'WW_POWER', 'CW_POWER', 'Hue', 'Saturation'];
    function onStateChangedColors(id, state, channelId, stateId) {
        if (!channelId) {
            let parts  = id.split('.');
            stateId    = parts.pop();

            if (stateId === 'level' || stateId === 'state' || stateId === 'red' || stateId === 'blue' || stateId === 'green') {
                stateId = parts.pop() + '.' + stateId;
            }

            channelId  = parts.splice(2, parts.length).join('.');
        }
        const ledModeIdExor = adapter.namespace + '.' + channelId + '.modeLedExor';
        if (cachedModeExor[ledModeIdExor] === undefined) {
            return adapter.getForeignState(ledModeIdExor, (err, _state) => {
                cachedModeExor[ledModeIdExor] = _state ? _state.val || false : true;
                setImmediate(() => onStateChangedColors(id, state, channelId, stateId));
            });
        }

        // ledstripe objects
        const exorWhiteLeds = cachedModeExor[ledModeIdExor]; // exor for white leds and color leds  => if white leds are switched on, color leds are switched off and vice versa (default on)

        // now evaluate ledstripe vars
        // adaptions for magichome tasmota
        if (stateId.match(/Color\d?/)) {
            //adapter.log.info('sending color');
            // id = sonoff.0.DVES_96ABFA.Color
            // statid=Color
            // state = {"val":"#faadcf","ack":false,"ts":1520146102580,"q":0,"from":"system.adapter.web.0","lc":1520146102580}

            // set white to rgb or rgbww
            adapter.getObject(id, (err, obj) => {
                if (!obj) {
                    adapter.log.warn('ill rgbww obj');
                } else {
                    const role = obj.common.role;
                    let color;

                    //adapter.log.info(state.val);
                    if (role === 'level.color.rgbww') {
                        // rgbww
                        if (state.val.toUpperCase() === '#FFFFFF') {
                            // transform white to WW
                            //color='000000FF';
                            color = state.val.substring(1) + '00';
                        } else {
                            // strip # char and add ww
                            color = state.val.substring(1) + '00';
                        }
                    } else if (role === 'level.color.rgbcwww') {
                        color = state.val.substring(1) + '0000';
                    } else {
                        // rgb, strip # char
                        color = state.val.substring(1);
                    }

                    //adapter.log.info('color :' + color + ' : ' + role);
                    // strip # char
                    //color=state.val.substring(1);

                    setColor(channelId, color);

                    // set rgb too
                    const hidE = id.split('.');
                    const deviceDesc = hidE[0] + '.' + hidE[1] + '.' + hidE[2];
                    let idAlive = deviceDesc + '.Red';
                    adapter.setState(idAlive, 100 * parseInt(color.substring(0, 2), 16) / 255, true);

                    idAlive = deviceDesc + '.Green';
                    adapter.setState(idAlive, 100 * parseInt(color.substring(2, 4), 16) / 255, true);

                    idAlive = deviceDesc + '.Blue';
                    adapter.setState(idAlive, 100 * parseInt(color.substring(4, 6), 16) / 255, true);
                }
            });
        } else {
            const hidE = id.split('.');
            const deviceDesc = hidE[0] + '.' + hidE[1] + '.' + hidE[2];
            if (stateId.match(/Red\d?/)) {
                // set red component
                if (state.val > 100) state.val = 100;
                const red = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
                const idAlive = deviceDesc + '.Color';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        adapter.setState(idAlive, '#000000', false);
                        return;
                    }
                    const color = state.val.substring(1);
                    // replace red component
                    const out = red + color.substring(2, 10);
                    adapter.setState(idAlive, '#' + out, false);
                    setColor(channelId, out);
                });
            } else
            if (stateId.match(/Green\d?/)) {
                // set green component
                if (state.val > 100) state.val = 100;
                const green = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
                const idAlive = deviceDesc + '.Color';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        adapter.setState(idAlive, '#000000', false);
                        return;
                    }
                    const color = state.val.substring(1);
                    // replace green component
                    const out = color.substring(0, 2) + green + color.substring(4, 10);
                    adapter.setState(idAlive, '#' + out, false);
                    setColor(channelId, out);
                });
            } else
            if (stateId.match(/Blue\d?/)) {
                // set blue component
                if (state.val > 100) state.val = 100;
                const blue = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
                const idAlive = deviceDesc + '.Color';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        adapter.setState(idAlive, '#000000', false);
                        return;
                    }
                    const color = state.val.substring(1);
                    // replace blue component
                    const out = color.substring(0, 4) + blue + color.substring(6, 10);
                    adapter.setState(idAlive, '#' + out, false);
                    setColor(channelId, out);
                });
            } else
            if (stateId.match(/RGB_POWER\d?/)) {
                // set ww component
                const rgbpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
                const idAlive = deviceDesc + '.Color';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        //adapter.log.warn('ill state Color');
                        adapter.setState(idAlive, '#000000', false);
                        return;
                    }
                    const color = state.val.substring(1);
                    let rgb = '000000';
                    if (rgbpow === true) {
                        rgb = 'FFFFFF';
                    }
                    // replace rgb component
                    let out = rgb + color.substring(6, 10);

                    if (rgbpow && exorWhiteLeds) {
                        //adapter.log.info('reset white');
                        out = rgb + '0000';
                        let idAlive = deviceDesc + '.WW_POWER';
                        adapter.setState(idAlive, false, false);
                        idAlive = deviceDesc + '.WW';
                        adapter.setState(idAlive, 0, false);
                        idAlive = deviceDesc + '.CW_POWER';
                        adapter.setState(idAlive, false, false);
                        idAlive = deviceDesc + '.CW';
                        adapter.setState(idAlive, 0, false);
                    }
                    setColor(channelId, out);
                    adapter.setState(idAlive, '#' + out, false);
                    if (rgbpow) {
                        setPower(channelId, true)
                    }
                    // if led_mode&1, exor white leds

                });
            } else
            // calc hue + saturation params to rgb
            if (hueCalc && stateId.match(/Hue\d?/)) {
                let hue = state.val;
                if (hue > 359) hue = 359;
                // recalc color by hue
                const idAlive = deviceDesc + '.Dimmer';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        const dim = 100;
                        adapter.setState(idAlive, dim, true);
                        //adapter.log.warn('ill state Dimmer');
                    } else {
                        const dim = state.val;
                        let idAlive = deviceDesc + '.Saturation';
                        adapter.getForeignState(idAlive, (err, state) => {
                            if (!state) {
                                const sat = 100;
                                adapter.setState(idAlive, sat, true);
                            } else {
                                const sat = state.val;
                                const rgb = hsvToRgb(hue, sat, dim);
                                const hexval = componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
                                let idAlive = deviceDesc + '.Color';
                                adapter.setState(idAlive, '#' + hexval, false);
                            }
                        });
                    }
                });
            } else
            if (hueCalc && stateId.match(/Saturation\d?/)) {
                let sat = state.val;
                if (sat > 100) sat = 100;
                // recalc color by saturation
                const idAlive = deviceDesc + '.Dimmer';
                adapter.getForeignState(idAlive, (err, state) => {
                    if (!state) {
                        const dim = 100;
                        adapter.setState(idAlive, dim, true);
                        //adapter.log.warn('ill state Dimmer');
                    } else {
                        const dim = state.val;
                        const idAlive = deviceDesc + '.Hue';
                        adapter.getForeignState(idAlive, (err, state) => {
                            if (!state) {
                                const hue = 100;
                                adapter.setState(idAlive, hue, true);
                            } else {
                                const hue = state.val;
                                const rgb = hsvToRgb(hue, sat, dim);
                                const hexval = componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
                                const idAlive = deviceDesc + '.Color';
                                adapter.setState(idAlive, '#' + hexval, false);
                            }
                        });
                    }
                });
            } else {
                // get color attributes to check other ledstripe vars
                const idAlive = deviceDesc + '.Color';
                adapter.getForeignObject(idAlive, (err, obj) => {
                    if (!obj) {
                        // no color object
                        adapter.log.warn(`unknown object: ${id}: ${state}`);
                    } else {
                        const role = obj.common.role;
                        //if (role='level.color.rgb') return;
                        let wwindex;
                        if (role === 'level.color.rgbww') {
                            wwindex = 6;
                        } else {
                            wwindex = 8;
                        }

                        if (stateId.match(/WW_POWER\d?/)) {
                            // set ww component
                            const wwpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
                            const idAlive = deviceDesc + '.Color';
                            adapter.getForeignState(idAlive, (err, state) => {
                                if (!state) {
                                    adapter.log.warn('ill state Color');
                                    return;
                                }
                                const color = state.val.substring(1);
                                let ww = '00';
                                if (wwpow) {
                                    ww = 'FF';
                                }
                                // replace ww component
                                let out = color.substring(0, wwindex) + ww;
                                if (wwpow && exorWhiteLeds) {
                                    //adapter.log.info('reset white');
                                    out = '000000' + ww;
                                    let idAlive = deviceDesc + '.RGB_POWER';
                                    adapter.setState(idAlive,false, false);
                                }

                                let idAlive = deviceDesc + '.Color';
                                adapter.setState(idAlive,'#' + out, false);
                                setColor(channelId, out);

                                // set ww channel
                                idAlive = deviceDesc + '.WW';
                                adapter.setState(idAlive, 100 * parseInt(out.substring(6, 8), 16) / 255, true);

                                // in case POWER is off, switch it on
                                wwpow && setPower(channelId, true)
                            });
                        } else
                        if (stateId.match(/CW_POWER\d?/)) {
                            // set ww component
                            const cwpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
                            const idAlive = deviceDesc + '.Color';
                            adapter.getForeignState(idAlive, (err, state) => {
                                if (!state) {
                                    adapter.log.warn('ill state Color');
                                    return;
                                }
                                const color = state.val.substring(1);
                                let cw = '00';
                                if (cwpow) {
                                    cw = 'FF';
                                }
                                // replace cw component
                                let out = color.substring(0, 6) + cw + color.substring(8, 10);
                                if (cwpow && exorWhiteLeds) {
                                    //adapter.log.info('reset white');
                                    out = '000000' + cw + color.substring(8, 10);
                                    let idAlive = deviceDesc + '.RGB_POWER';
                                    adapter.setState(idAlive, false, false);
                                }

                                let idAlive = deviceDesc + '.Color';
                                adapter.setState(idAlive, '#' + out, false);
                                setColor(channelId, out);

                                // set cw channel
                                idAlive = deviceDesc + '.CW';
                                adapter.setState(idAlive, 100 * parseInt(out.substring(6, 8), 16) / 255, true);

                                // in case POWER is off, switch it on
                                if (cwpow) {
                                    let idAlive = deviceDesc + '.POWER';
                                    adapter.setState(idAlive, true, false);
                                }
                            });
                        } else
                        if (stateId.match(/WW\d?/)) {
                            // set ww component
                            const ww = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
                            const idAlive = deviceDesc + '.Color';
                            adapter.getForeignState(idAlive, (err, state) => {
                                if (!state) {
                                    adapter.setState(idAlive, '#000000', false);
                                    return;
                                }
                                const color = state.val.substring(1);
                                // replace ww component
                                const out = color.substring(0, wwindex) + ww;
                                setColor(channelId, out);
                            });
                        } else
                        if (stateId.match(/CW\d?/)) {
                            // set ww component
                            const cw = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
                            const idAlive = deviceDesc + '.Color';
                            adapter.getForeignState(idAlive, (err, state) => {
                                if (!state) {
                                    adapter.setState(idAlive, '#000000', false);
                                    return;
                                }
                                const color = state.val.substring(1);
                                // replace cw component
                                const out = color.substring(0, 6) + cw + color.substring(8, 10);
                                setColor(channelId, out);
                            });
                        }
                    }
                });
            }
        }
    }

    this.onStateChange = (id, state) => {
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server && state && !state.ack) {
            // find client.id
            let parts       = id.split('.');
            const stateId   = parts.pop();
            const channelId = parts.splice(2, parts.length).join('.');
            if (clients[mappingClients[channelId]]) {
                // check for special ledstripe vars
                if (specVars.indexOf(stateId) === -1) {
                    // other objects
                    adapter.getObject(id, (err, obj) => {
                        if (!obj) {
                            adapter.log.warn(`invalid  obj ${id}`);
                        } else {
                            const type = obj.common.type;
                            switch (type) {
                                case 'boolean':
                                    setStateImmediate(mappingClients[channelId], stateId, state.val ? 'ON' : 'OFF');
                                    break;
                                case 'number':
                                    setStateImmediate(mappingClients[channelId], stateId, state.val.toString());
                                    break;
                                case 'string':
                                    setStateImmediate(mappingClients[channelId], stateId, state.val);
                                    break;
                            }
                        }
                    });
                } else {
                    onStateChangedColors(id, state, channelId, stateId);
                }
            } else {
                //Client:"DVES_96ABFA : MagicHome" not connected => State: sonoff.0.myState - Value: 0, ack: false, time stamp: 1520369614189, last changed: 1520369614189
                // if (server && state && !state.ack) {
                // server = false
                // or state = false
                // or state.ack = true
                // or clients[channelId] = false
                adapter.log.warn(`Client "${channelId}" not connected`);

                /*
                 if (!clients[channelId]) {
                      var idAlive='sonoff.0.'+channelId+'.INFO.IPAddress';
                      adapter.getForeignState(idAlive, function (err, state) {
                         if (!state) {
                             adapter.log.warn('Client "' + channelId + '" could not get ip adress');
                         } else {
                              var ip=state.val;
                              adapter.log.warn('Clients ip "' + ip);

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
    };

    function processTasks() {
        if (tasks && tasks.length) {
            let task = tasks[0];
            if (task.type === 'addObject') {
                if (!cacheAddedObjects[task.id]) {
                    cacheAddedObjects[task.id] = true;
                    adapter.getForeignObject(task.id, (err, obj) => {
                        if (!obj) {
                            adapter.setForeignObject(task.id, task.data, (/* err */) => {
                                adapter.log.info('new object created: ' + task.id);
                                tasks.shift();
                                if (task.cb) {
                                    task.cb(task.id, task.cbArg);
                                } else {
                                    setImmediate(processTasks);
                                }
                            });
                        } else {
                            tasks.shift();
                            if (task.cb) {
                                task.cb(task.id, task.cbArg);
                            } else {
                                setImmediate(processTasks);
                            }
                        }
                    });
                } else {
                    tasks.shift();
                    if (task.cb) {
                        task.cb(task.id, task.cbArg);
                    } else {
                        setImmediate(processTasks);
                    }
                }
            } else if (task.type === 'extendObject') {
                adapter.extendObject(task.id, task.data, (/* err */) => {
                    tasks.shift();
                    if (task.cb) {
                        task.cb(task.id, task.cbArg);
                    } else {
                        setImmediate(processTasks);
                    }
                });
            } else if (task.type === 'deleteState') {
                adapter.deleteState('', '', task.id, (/* err */) => {
                    tasks.shift();
                    if (task.cb) {
                        task.cb(task.id, task.cbArg);
                    } else {
                        setImmediate(processTasks);
                    }
                });
            } else {
                adapter.log.error('Unknown task name: ' + JSON.stringify(task));
                tasks.shift();
                if (task.cb) {
                    task.cb(task.id, task.cbArg);
                } else {
                    setImmediate(processTasks);
                }
            }
        }
    }

    function createClient(client) {
        // mqtt.0.cmnd.sonoff.POWER
        // mqtt.0.stat.sonoff.POWER
        let isStart = !tasks.length;

        let id = adapter.namespace + '.' + client.iobId;
        let obj = {
            _id: id,
            common: {
                name: client.id,
                desc: ''
            },
            native: {
                clientId: client.id
            },
            type: 'channel'
        };
        tasks.push({type: 'addObject', id: obj._id, data: obj});

        obj = {
            _id: id + '.alive',
            common: {
                type: 'boolean',
                role: 'indicator.reachable',
                read: true,
                write: false,
                name: client.id + ' alive'
            },
            type: 'state'
        };
        tasks.push({type: 'addObject', id: obj._id, data: obj});
        if (isStart) {
            processTasks(tasks);
        }
    }

    function updateClients() {
        let text = '';
        if (clients) {
            for (let id in clients) {
                text += (text ? ',' : '') + id;
            }
        }

        adapter.setState('info.connection', {val: text, ack: true});
    }

    function updateAlive(client, alive) {
        let idAlive = adapter.namespace + '.' + client.iobId + '.alive';

        adapter.getForeignState(idAlive, (err, state) => {
            if (!state || state.val !== alive) {
                adapter.setForeignState(idAlive, alive, true);
            }
        });
    }

    function sendState2Client(client, topic, state, qos, retain, cb) {
        if (typeof qos === 'function') {
            cb = qos;
            qos = undefined;
        }
        if (typeof retain === 'function') {
            cb = retain;
            retain = undefined;
        }
        adapter.log.debug('Send to "' + client.id + '": ' + topic + ' = ' + state);
        client.publish({topic: topic, payload: state, qos: qos, retain: retain, messageId: messageId++}, cb);
        messageId &= 0xFFFFFFFF;
    }

    function resendMessages2Client(client, messages, i) {
        i = i || 0;
        if (messages && i < messages.length) {
            try {
                messages[i].ts = Date.now();
                messages[i].count++;
                adapter.log.debug(`Client [${client.id}] Resend messages on connect: ${messages[i].topic} = ${messages[i].payload}`);
                if (messages[i].cmd === 'publish') {
                    client.publish(messages[i]);
                }
            } catch (e) {
                adapter.log.warn(`Client [${client.id}] Cannot resend message: ${e}`);
            }

            if (adapter.config.sendInterval) {
                setTimeout(() => resendMessages2Client(client, messages, i + 1), adapter.config.sendInterval);
            } else {
                setImmediate(() => resendMessages2Client(client, messages, i + 1));
            }
        } else {
            //return;
        }
    }

    function addObject(attr, client, prefix, path) {
        let replaceAttr = types[attr].replace || attr;
        let id = adapter.namespace + '.' + client.iobId + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr.replace(FORBIDDEN_CHARS, '_');
        let obj = {
            type: 'addObject',
            id: id,
            data: {
                _id: id,
                common: Object.assign({}, types[attr]),
                native: {},
                type: 'state'
            }
        };
        obj.data.common.name = client.id + ' ' + (prefix ? prefix + ' ' : '') + (path.length ? path.join(' ') + ' ' : '') + ' ' + replaceAttr;
        return obj;
    }

    function checkData(client, topic, prefix, data, unit, path) {
        if (!data || typeof data !== 'object') {
            return;
        }

        const ledModeReadColorsID = adapter.namespace + '.' + client.iobId + '.modeReadColors';

        if (cachedReadColors[ledModeReadColorsID] === undefined) {
            return adapter.getForeignState(ledModeReadColorsID, (err, state) => {
                cachedReadColors[ledModeReadColorsID] = (state && state.val) || false;
                setImmediate(() => checkData(client, topic, prefix, data, unit, path));
            });
        }

        path   = path || [];
        prefix = prefix || '';

        // first get the units
        if (data.TempUnit) {
            adapter.log.info('[' + client.id + '] 1. data.TempUnit: ' + data.TempUnit);
            unit = data.TempUnit;
            if (unit.indexOf('°') !== 0) {
                unit = '°' + unit.replace('°');
            }
        }

        for (let attr in data) {
            adapter.log.warn('[' + client.id + '] 2. attr in data: "' + attr + '" : "' + data[attr] + '"');
            if (!data.hasOwnProperty(attr)) {
                adapter.log.warn('[' + client.id + '] attr error: ' + attr + '' + data[attr]);
                continue;
            }

            if (typeof data[attr] === 'object') {
                // check for arrays
                if (types[attr]) {
                    adapter.log.info('3. types-attr "' + client.iobId + '":"' + types[attr] + '"');
                    if (types[attr].type === 'array') {
                        // transform to array of attributes
                        for (let i = 1; i <= 10; i++) {
                            let val = data[attr][i - 1];
                            if (typeof val === 'undefined') break;
                            // define new object
                            let replaceAttr = attr.replace(FORBIDDEN_CHARS, '_') + i.toString();
                            let id = adapter.namespace + '.' + client.iobId + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr;
                            let obj = {
                                type: 'addObject',
                                id: id,
                                data: {
                                    _id: id,
                                    common: Object.assign({}, types[attr]),
                                    native: {},
                                    type: 'state'
                                }
                            };
                            obj.data.common.name = client.id + ' ' + (prefix ? prefix + ' ' : '') + (path.length ? path.join(' ') + ' ' : '') + ' ' + replaceAttr;
                            obj.data.common.type = 'number';
                            updateState(obj, val);
                        }
                    } else {
                        let nPath = Object.assign([], path);
                        nPath.push(attr.replace(FORBIDDEN_CHARS, '_'));
                        checkData(client, topic, prefix, data[attr], unit, nPath);
                        nPath = undefined;
                    }
                } else {
                    // Object muss checkdata für jedes element aufgerufen werden!
                    let nPath = Object.assign([], path);
                    nPath.push(attr.replace(FORBIDDEN_CHARS, '_'));
                    adapter.log.info('checkData2: "' + topic + '":"' + prefix + '":"' + data[attr] + '":"' + unit + '":"' + nPath + '"');
//                    if (prefix.match(/SENSOR\d?/)) {
//                        prefix = 'SENSOR';
//                    }
                    //prefix = prefix + '.' + nPath;
                    checkData(client, topic, prefix + '.' + nPath, data[attr], unit);
                    nPath = undefined;
                }
            } else if (types[attr]) {
                let allowReadColors;

                // create object
                const obj = addObject(attr, client, prefix, path);
                let replaceAttr = types[attr].replace || attr;

                if (attr === 'Temperature') {
                    obj.data.common.unit = obj.data.common.unit || unit || '°C';
                }
                if (attr === 'Humidity') {
                    obj.data.common.unit = obj.data.common.unit || unit || '%';
                }
                if (obj.data.common.storeMap) {
                    delete obj.data.common.storeMap;
                    client._map[replaceAttr] = topic.replace(/$\w+\//, 'cmnd/').replace(/\/\w+$/, '/' + replaceAttr);
                }

                // adaptions for magichome tasmota
                if (attr === 'Color') {
                    // read vars
                    allowReadColors = cachedReadColors[ledModeReadColorsID]; // allow for color read from MQTT (default off)

                    // if ledFlags bit 2, read color from tasmota, else ignore
                    if (data[attr].length === 10) {
                        obj.data.common.role = 'level.color.rgbcwww';  // RGB + cold white + white???
                    } else if (data[attr].length === 8) {
                        obj.data.common.role = 'level.color.rgbww'; // RGB + White
                    } else {
                        obj.data.common.role = 'level.color.rgb';
                    }

                    if (hueCalc) {
                        // Create LEDs modes if required
                        let xObj = addObject('modeReadColors', client, prefix, path);
                        updateState(xObj);

                        xObj = addObject('modeLedExor', client, prefix, path);
                        updateState(xObj);

                        xObj = addObject('Hue', client, prefix, path);
                        updateState(xObj);

                        xObj = addObject('Saturation', client, prefix, path);
                        updateState(xObj);

                        xObj = addObject('Red', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(0, 2), 16) / 255 : undefined);

                        xObj = addObject('Green', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(2, 4), 16) / 255 : undefined);

                        xObj = addObject('Blue', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(4, 6), 16) / 255 : undefined);

                        xObj = addObject('RGB_POWER', client, prefix, path);
                        xObj.data.common.read = allowReadColors;
                        let val = parseInt(data[attr].substring(0, 6), 16);
                        updateState(xObj, allowReadColors ? (val > 0) : undefined);

                        if (obj.data.common.role === 'level.color.rgbww') {
                            // rgbww
                            xObj = addObject('WW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(6, 8), 16) / 255 : undefined);

                            xObj = addObject('WW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            updateState(xObj, allowReadColors ? (val > 0) : undefined);
                        } else
                        if (obj.data.common.role === 'level.color.rgbcwww') {
                            // rgbcwww
                            xObj = addObject('CW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(6, 8), 16) / 255 : undefined);

                            xObj = addObject('CW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            updateState(xObj, allowReadColors ? (val > 0) : undefined);

                            xObj = addObject('WW', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            updateState(xObj, allowReadColors ? 100 * parseInt(data[attr].substring(8, 10), 16) / 255 : undefined);

                            xObj = addObject('WW_POWER', client, prefix, path);
                            xObj.data.common.read = allowReadColors;
                            val = parseInt(data[attr].substring(8, 10), 16);
                            updateState(xObj, allowReadColors ? (val > 0) : undefined);
                        }
                    }
                }

                let val;
                if (obj.data.common.type === 'number') {
                    val = parseFloat(data[attr]);
                } else if (obj.data.common.type === 'boolean') {
                    const _value = (data[attr] || '').toUpperCase();
                    val = _value === 'ON' || _value === 'TRUE' || _value === '1';
                } else {
                    if (attr === 'Color') {
                        // add # char
                        if (allowReadColors) {
                            val = '#' + data[attr];
                        }
                    } else {
                        val = data[attr];
                    }
                }
                updateState(obj, val);
            } else {
                // not in list, auto insert
                //if (client.id=='DVES_008ADB') {
                //	adapter.log.warn('[' + client.id + '] Received attr not in list: ' + attr + '' + data[attr]);
                //}
                // tele/sonoff/SENSOR  tele/sonoff/STATE => read only
                // stat/sonoff/RESULT => read,write

				let parts = topic.split('/');
				// auto generate objects
				if ((parts[0] === 'tele' && (
						(adapter.config.TELE_SENSOR && parts[2] === 'SENSOR') ||
						(adapter.config.TELE_STATE  && parts[2] === 'STATE'))) ||
					(parts[0] === 'stat' &&
						(adapter.config.STAT_RESULT && parts[2] === 'RESULT'))
				) {
					//adapter.log.info('[' + client.id + '] auto insert object: ' + attr + ' ' + data[attr] + ' flags: ' + autoFlags);
					//if (data[attr]) {
					const xdata = data[attr];
					//adapter.log.info('[' + client.id + '] auto insert object: ' + attr + ' ' + data[attr]);
					let attributes;
					if (parts[2] === 'RESULT') {
						if (xdata.isNaN) {
							// string
							attributes = {type: 'string', role:'value', read: true, write: true};
						} else {
							// number
							attributes = {type: 'number', role:'value', read: true, write: true};
						}
					} else {
						if (xdata.isNaN) {
							// string
							attributes = {type: 'string', role: 'value', read: true, write: false};
						} else {
							// number
							attributes = {type: 'number', role: 'value', read: true, write: false};
						}
					}
					let replaceAttr = attr ;
					let id = adapter.namespace + '.' + client.iobId + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr;
					let obj = {
						type: 'addObject',
						id: id,
						data: {
							_id: id,
							common: Object.assign({}, attributes),
							native: {},
							type: 'state'
						}
					};
					obj.data.common.name = client.id + ' ' + (prefix ? prefix + ' ' : '') + (path.length ? path.join(' ') + ' ' : '') + ' ' + replaceAttr;
					updateState(obj, xdata);
				}
            }
        }
    }

    function receivedTopic(packet, client) {
        if (!packet) {
            return adapter.log.warn('Empty packet received: ' + JSON.stringify(packet));
        }

        client.states = client.states || {};
        client.states[packet.topic] = {
            message: packet.payload,
            retain: packet.retain,
            qos: packet.qos
        };

        // update alive state
        updateAlive(client, true);

        if (client._will && client._will.topic && packet.topic === client._will.topic) {
            client._will.payload = packet.payload;
            return;
        }

        let val = packet.payload.toString('utf8');
        adapter.log.debug('[' + client.id + '] Received: ' + packet.topic + ' = ' + val);

        /*
        adapter.getForeignState('system.adapter.sonoff.0.memRss', (err, state) => {
            adapter.log.info('mem: ' + state.val + ' MB');
            if (heapTest==0 || (heapTest==1 && state.val>37.5)) {
                heapTest+=1;
                heapdump.writeSnapshot('/opt/iobroker/' + Date.now() + '.heapsnapshot');
                adapter.log.info('Wrote snapshot: ');

                var filename='/opt/iobroker/' + Date.now() + '.heapsnapshot';
                heapdump.writeSnapshot((err,filename) => {
                    if (err) {
                        adapter.log.info('heap: ' + err);
                    } else {
                        adapter.log.info('Wrote snapshot: ' + filename);
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
        client._map = client._map || {};

        const parts = packet.topic.split('/');

        if (!client._fallBackName) {
            client._fallBackName = parts[1];
        }

        const stateId = parts.pop();

        if (stateId === 'LWT') {
            return;
        }

        if (val.indexOf('nan') !== -1) {
            val = val.replace(/:nan,/g, ':"NaN",').replace(/:nan}/g, ':"NaN"}').replace(/:nan]/g, ':"NaN"]');
        }

        if (stateId === 'RESULT') {
            // ignore: stat/Sonoff/RESULT = {"POWER":"ON"}
            // testserver.js reports error, so reject above cmd
            const str = val.replace(/\s+/g, '');
            if (str.startsWith('{"POWER":"ON"}')) return;
            if (str.startsWith('{"POWER":"OFF"}')) return;


            if (parts[0] === 'stat') {
                try {
                    checkData(client, packet.topic, 'RESULT', JSON.parse(val));
                } catch (e) {
                    adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
                }
                return;
            }
            if (parts[0] === 'tele') {
                try {
                    checkData(client, packet.topic, 'RESULT', JSON.parse(val));
                } catch (e) {
                    adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
                }
            }
            return;
        }

        // tele/sonoff_4ch/STATE = {"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}
        if (parts[0] === 'tele' && stateId.match(/^STATE\d?$/)) {
            try {
                checkData(client, packet.topic, 'STATE', JSON.parse(val));
                //adapter.log.warn('log sensor parse"' + stateId + '": _' + val);
            } catch (e) {
                adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
            }
        // tele/sonoff/SENSOR    = {"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}
        // tele/sonoff5/SENSOR   = {"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}
        // tele/sonoff/SENSOR    = {"Time":"2018-02-23T17:36:59", "Analog0":298}
        } else if (parts[0] === 'tele' && stateId.match(/^SENSOR\d?$/)) {
            try {
                adapter.log.warn('log SENSOR parse: "' + stateId + '" : "' + client + '" : "'  + packet.topic + '" : "'  + val + '"');
                checkData(client, packet.topic, 'SENSOR', JSON.parse(val));
                //adapter.log.warn('log sensor parse"' + stateId + '": _' + val);
            } catch (e) {
                adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
            }
        } else if (parts[0] === 'tele' && stateId.match(/^WAKEUP\d?$/)) {
            try {
                checkData(client, packet.topic, 'WAKEUP', JSON.parse(val));
                //adapter.log.warn('log sensor parse"' + stateId + '": _' + val);
            } catch (e) {
                adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
            }
        } else if (parts[0] === 'tele' && stateId.match(/^INFO\d?$/)) {
            // tele/SonoffPOW/INFO1 = {"Module":"Sonoff Pow", "Version":"5.8.0", "FallbackTopic":"SonoffPOW", "GroupTopic":"sonoffs"}
            // tele/SonoffPOW/INFO2 = {"WebServerMode":"Admin", "Hostname":"Sonoffpow", "IPAddress":"192.168.2.182"}
            // tele/SonoffPOW/INFO3 = {"RestartReason":"Software/System restart"}
            try {
                checkData(client, packet.topic, 'INFO', JSON.parse(val));
            } catch (e) {
                adapter.log.warn('Cannot parse data"' + stateId + '": _' + val + '_ - ' + e);
            }
        } else if (parts[0] === 'tele' && stateId.match(/^(ENERGY)\d?$/)) {
            // tele/sonoff_4ch/ENERGY = {"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}
            try {
                checkData(client, packet.topic, 'ENERGY', JSON.parse(val));
            } catch (e) {
                adapter.log.warn('Cannot parse data"' + stateId + '": _' + val + '_ - ' + e);
            }
        } else if (types[stateId]) {
            // /ESP_BOX/BM280/Pressure = 1010.09
            // /ESP_BOX/BM280/Humidity = 42.39
            // /ESP_BOX/BM280/Temperature = 25.86
            // /ESP_BOX/BM280/Approx. Altitude = 24

            // cmnd/sonoff/POWER
            // stat/sonoff/POWER

            if (types[stateId]) {
                let id = adapter.namespace + '.' + client.iobId + '.' + stateId.replace(/[-.+\s]+/g, '_');
                let obj = {
                    type: 'addObject',
                    id: id,
                    data: {
                        _id: id,
                        common: JSON.parse(JSON.stringify(types[stateId])),
                        native: {},
                        type: 'state'
                    }
                };
                obj.data.common.name = client.id + ' ' + stateId;

                // push only new objects
                updateState(obj);

                if (parts[0] === 'cmnd') {

                    // Set Object fix
                    if (obj.data.common.type === 'number') {
                        adapter.setState(id, parseFloat(val), true);
                    } else if (obj.data.common.type === 'boolean') {
                    	if (val === 'ON' || val === '1' || val === 'true' || val === 'on') {
                            adapter.setState(id, true, true);
                    	} else if (val === 'OFF' || val === '0' || val === 'false' || val === 'off') {
                            adapter.setState(id, false, true);
                    	}
                    } else {
                        adapter.setState(id, val, true);
                    }

                    // remember POWER topic
                    client._map[stateId] = packet.topic;
                } else {
                    if (obj.data.common.type === 'number') {
                        adapter.setState(id, parseFloat(val), true);
                    } else if (obj.data.common.type === 'boolean') {
                    	if (val === 'ON' || val === '1' || val === 'true' || val === 'on') {
                            adapter.setState(id, true, true);
                    	} else if (val === 'OFF' || val === '0' || val === 'false' || val === 'off') {
                            adapter.setState(id, false, true);
                    	}
                    } else {
                        adapter.setState(id, val, true);
                    }
                }
            } else {
                adapter.log.debug('Cannot process: ' + packet.topic);
            }
        }
    }

    function clientClose(client, reason) {
        if (!client) return;

        if (persistentSessions[client.id]) {
            persistentSessions[client.id].connected = false;
        }

        if (client._resendonStart) {
            clearTimeout(client._resendonStart);
            client._resendonStart = null;
        }

        try {
            if (clients[client.id] && (client.__secret === clients[client.id].__secret)) {
                adapter.log.info(`Client [${client.id}] connection closed: ${reason}`);
                updateAlive(client, false);
                delete clients[client.id];
                updateClients();
                if (client._will) {
                    receivedTopic(client._will, client, () => client.destroy());
                } else {
                    client.destroy();
                }
            } else {
                client.destroy();
            }
        } catch (e) {
            adapter.log.warn(`Client [${client.id}] Cannot close client: ${e}`);
        }
    }

    function checkResends() {
        const now = Date.now();
        resending = true;
        for (const clientId in clients) {
            if (clients.hasOwnProperty(clientId) && clients[clientId] && clients[clientId]._messages) {
                for (let m = clients[clientId]._messages.length - 1; m >= 0; m--) {
                    const message = clients[clientId]._messages[m];
                    if (now - message.ts >= adapter.config.retransmitInterval) {
                        if (message.count > adapter.config.retransmitCount) {
                            adapter.log.warn(`Client [${clientId}] Message ${message.messageId} deleted after ${message.count} retries`);
                            clients[clientId]._messages.splice(m, 1);
                            continue;
                        }

                        // resend this message
                        message.count++;
                        message.ts = now;
                        try {
                            adapter.log.debug(`Client [${clientId}] Resend message topic: ${message.topic}, payload: ${message.payload}`);
                            if (message.cmd === 'publish') {
                                clients[clientId].publish(message);
                            }
                        } catch (e) {
                            adapter.log.warn(`Client [${clientId}] Cannot publish message: ${e}`);
                        }

                        if (adapter.config.sendInterval) {
                            setTimeout(checkResends, adapter.config.sendInterval);
                        } else {
                            setImmediate(checkResends);
                        }
                        return;
                    }
                }
            }
        }

        // delete old sessions
        if (adapter.config.storeClientsTime !== -1) {
            for (const id in persistentSessions) {
                if (persistentSessions.hasOwnProperty(id)) {
                    if (now - persistentSessions[id].lastSeen > adapter.config.storeClientsTime * 60000) {
                        delete persistentSessions[id];
                    }
                }
            }
        }

        resending = false;
    }

    (function _constructor(config) {
        if (config.timeout === undefined) {
            config.timeout = 300;
        } else {
            config.timeout = parseInt(config.timeout, 10);
        }

        server.on('connection', stream => {
            let client = mqtt(stream);
            // Store unique connection identifier
            client.__secret = Date.now() + '_' + Math.round(Math.random() * 10000);

            // client connected
            client.on('connect', options => {
                // acknowledge the connect packet
                client.id = options.clientId;
                client.iobId = client.id.replace(FORBIDDEN_CHARS, '_');
                mappingClients[client.iobId] = client.id;

                // get possible old client
                let oldClient = clients[client.id];

                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== options.password.toString()) {
                        adapter.log.warn(`Client [${client.id}]  has invalid password(${options.password}) or username(${options.username})`);
                        client.connack({returnCode: 4});
                        if (oldClient) {
                            // delete existing client
                            delete clients[client.id];
                            updateAlive(oldClient, false);
                            updateClients();
                            oldClient.destroy();
                        }
                        client.destroy();
                        return;
                    }
                }

                if (oldClient) {
                    adapter.log.info(`Client [${client.id}] reconnected. Old secret ${clients[client.id].__secret}. New secret ${client.__secret}`);
                    // need to destroy the old client

                    if (client.__secret !== clients[client.id].__secret) {
                        // it is another socket!!

                        // It was following situation:
                        // - old connection was active
                        // - new connection is on the same TCP
                        // Just forget him
                        // oldClient.destroy();
                    }
                } else {
                    adapter.log.info(`Client [${client.id}] connected with secret ${client.__secret}`);
                }

                let sessionPresent = false;

                if (!client.cleanSession && adapter.config.storeClientsTime !== 0) {
                    if (persistentSessions[client.id]) {
                        sessionPresent = true;
                        persistentSessions[client.id].lastSeen = Date.now();
                    } else {
                        persistentSessions[client.id] = {
                            _subsID: {},
                            _subs: {},
                            messages: [],
                            lastSeen: Date.now()
                        };
                    }
                    client._messages = persistentSessions[client.id].messages;
                    persistentSessions[client.id].connected = true;
                } else if (client.cleanSession && persistentSessions[client.id]) {
                    delete persistentSessions[client.id];
                }
                client._messages = client._messages || [];

                client.connack({returnCode: 0, sessionPresent});
                clients[client.id] = client;
                updateClients();

                client._will = options.will;
                createClient(client);

                if (persistentSessions[client.id]) {
                    client._subsID = persistentSessions[client.id]._subsID;
                    client._subs = persistentSessions[client.id]._subs;
                    if (persistentSessions[client.id].messages.length) {
                        // give to the client a little bit time
                        client._resendonStart = setTimeout(clientId => {
                            client._resendonStart = null;
                            resendMessages2Client(client, persistentSessions[clientId].messages);
                        }, 100, client.id);
                    }
                }
            });

            // timeout idle streams after 5 minutes
            if (config.timeout) {
                stream.setTimeout(config.timeout * 1000);
            }

            // connection error handling
            client.on('close', had_error => clientClose(client, had_error ? 'closed because of error' : 'closed'));
            client.on('error', e => clientClose(client, e));
            client.on('disconnect', () => clientClose(client, 'disconnected'));
            // stream timeout
            stream.on('timeout', () => clientClose(client, 'timeout'));

            client.on('publish', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends publish. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                if (packet.qos === 1) {
                    // send PUBACK to client
                    client.puback({messageId: packet.messageId});
                } else if (packet.qos === 2) {
                    const pack = client._messages.find(e => e.messageId === packet.messageId);
                    if (pack) {
                        // duplicate message => ignore
                        adapter.log.warn(`Client [${client.id}] Ignored duplicate message with ID: ${packet.messageId}`);
                        return;
                    } else {
                        packet.ts = Date.now();
                        packet.cmd = 'pubrel';
                        packet.count = 0;
                        client._messages.push(packet);

                        client.pubrec({messageId: packet.messageId});
                        return;
                    }
                }


                receivedTopic(packet, client)
            });

            // response for QoS2
            client.on('pubrec', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubrec. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== -1) {
                    client.pubrel({messageId: packet.messageId});
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubrec on ${client.id} for unknown messageId ${packet.messageId}`);
                }
            });

            // response for QoS2
            client.on('pubcomp', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubcomp. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });
                if (pos !== null) {
                    client._messages.splice(pos, 1);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubcomp for unknown message ID: ${packet.messageId}`);
                }
            });

            // response for QoS2
            client.on('pubrel', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pubrel. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                let pos = null;
                // remove this message from queue
                client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });

                if (pos !== -1) {
                    client.pubcomp({messageId: packet.messageId});

                    receivedTopic(client._messages[pos], client);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received pubrel on ${client.id} for unknown messageId ${packet.messageId}`);
                }
            });

            // response for QoS1
            client.on('puback', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends puback. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                // remove this message from queue
                let pos = null;
                // remove this message from queue
                client._messages && client._messages.forEach((e, i) => {
                    if (e.messageId === packet.messageId) {
                        pos = i;
                        return false;
                    }
                });

                if (pos !== null) {
                    adapter.log.debug(`Client [${client.id}] Received puback for ${client.id} message ID: ${packet.messageId}`);
                    client._messages && client._messages.splice(pos, 1);
                } else {
                    adapter.log.warn(`Client [${client.id}] Received puback for unknown message ID: ${packet.messageId}`);
                }
            });

            client.on('unsubscribe', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends unsubscribe. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                client.unsuback({messageId: packet.messageId});
            });

            client.on('subscribe', packet => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends subscribe. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                // just confirm the request.
                // we expect subscribe for 'cmnd.sonoff.#'
                let granted = packet.subscriptions.map(subs => subs.qos);

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', (/*packet*/) => {
                if (clients[client.id] && client.__secret !== clients[client.id].__secret) {
                    !adapter.config.ignorePings && adapter.log.warn(`Old client ${client.id} with secret ${client.__secret} sends pingreq. Ignore! Actual secret is ${clients[client.id].__secret}`);
                    return;
                }

                if (persistentSessions[client.id]) {
                    persistentSessions[client.id].lastSeen = Date.now();
                }

                adapter.log.debug(`Client [${client.id}] pingreq`);
                client.pingresp();
            });
        });

        config.port = parseInt(config.port, 10) || 1883;

        config.retransmitInterval = config.retransmitInterval || 2000;
        config.retransmitCount    = config.retransmitCount    || 10;
        config.storeClientsTime   = config.storeClientsTime === undefined ? 1440 : parseInt(config.storeClientsTime, 10) || 0;
        config.defaultQoS         = parseInt(config.defaultQoS, 10) || 0;

        // Update connection state
        updateClients();

        // to start
        server.listen(config.port, config.bind, () => {
            adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + ' server on port ' + config.port);

            resendTimer = setInterval(() =>
                !resending && checkResends(),
                adapter.config.retransmitInterval || 2000);
        });
    })(adapter.config);

    return this;
}

module.exports = MQTTServer;
