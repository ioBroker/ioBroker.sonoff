/* jshint -W097 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const mqtt    = require('mqtt-connection');
const net     = require('net');
const types   = require(__dirname + '/datapoints');
const hueCalc = true;

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
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter);

    const NO_PREFIX = '';

    let server = new net.Server();
    let clients = {};
    let tasks = [];
    let messageId = 1;

    this.destroy = cb => {
        if (server) {
            let cnt = 0;
            for (let id in clients) {
                if (clients.hasOwnProperty(id)) {
                    cnt++;
                    adapter.setForeignState(adapter.namespace + '.' + clients[id].id + '.alive', false, true, () => {
                        if (!--cnt) {
                            // to release all resources
                            server.close(() => cb && cb());
                            server = null;
                        }
                    });
                }
            }
            if (!cnt) {
                // to release all resources
                server.close(() => cb && cb());
                server = null;
            }
        }
    };


    function setColor(channelId, val) {
		//adapter.log.info('color write: '+ val);
       	const stateId = 'Color';
   		if (clients[channelId]._map[stateId]) {
      		setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || 'cmnd/sonoff/Color', val);
       	} else if (clients[channelId]._fallBackName) {
       		setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val);
   		} else {
       		adapter.log.warn('Unknown mapping for "' + stateId + '"');
   		}	
    }

    function setPower(channelId, val) {
        const stateId = 'POWER';
        if (clients[channelId]._map[stateId]) {
            setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || 'cmnd/sonoff/POWER', val ? 'ON' : 'OFF');
        } else if (clients[channelId]._fallBackName) {
            setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val);
        } else {
            adapter.log.warn('Unknown mapping for "' + stateId + '"');
        }
    }
	
	function SetStateImmediate(channelId,stateId,val) {
		if (clients[channelId]._map && clients[channelId]._map[stateId]) {
        	setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || ('cmnd/sonoff/' + stateId), val);
   	 	} else if (clients[channelId]._fallBackName) {
        	setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, val);
    	} else {
        	adapter.log.warn('Unknown mapping for "' + stateId + '"');
    	}
	}

    this.onStateChange = (id, state) => {
		let specvars = ["Red","Green","Blue","WW","CW","Color","RGB_POWER","WW_POWER","CW_POWER","Hue","Saturation"];
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server && state && !state.ack) {
            // find client.id
            let parts = id.split('.');
            let stateId = parts.pop();
	    	let channelId = parts.splice(2,parts.length).join('.');
            if (clients[channelId]) {
				
				// check for special ledstripe vars
				var locvar = specvars.indexOf(stateId); 
				if (locvar<0) {
					// other objects
					adapter.getObject(id, function (err,obj) {
                        if (!obj) {
                            adapter.log.warn('ill obj');
                        } else {
							var type=obj.common.type;
							switch (type) {
								case 'boolean':
									SetStateImmediate(channelId,stateId,state.val ? 'ON' : 'OFF');
									break;
								case 'number':
									SetStateImmediate(channelId,stateId,state.val.toString());
									break;
								case 'string':
									SetStateImmediate(channelId,stateId,state.val);
									break;
							}
						}
					});
				} else {
					// ledstripe objects
					// get flags from LED_Mode, bit 0 exor cw,ww
					const hidE = id.split('.');
					let deviceDesc = hidE[0] + '.' + hidE[1] + '.' + hidE[2];
                	const idAlive = deviceDesc + '.LED_Mode';
                	adapter.getForeignState(idAlive, function (err, xstate) {
						var ledflags=1;
                        if (!xstate) {
                            adapter.log.warn('ill ledmode state');
						}
						ledflags=xstate.val;
							// now evaluate ledstripe vars
			                // adaptions for magichome tasmota
			                if (stateId.match(/Color\d?/)) {
			                    //adapter.log.info('sending color');
			                    // id = sonoff.0.DVES_96ABFA.Color
			                    // statid=Color
			                    // state = {"val":"#faadcf","ack":false,"ts":1520146102580,"q":0,"from":"system.adapter.web.0","lc":1520146102580}

			                    // set white to rgb or rgbww
			                    adapter.getObject(id, function (err, obj) {
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
					                    let deviceDesc = hidE[0] + '.' + hidE[1] + '.' + hidE[2];
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
			                    let deviceDesc = hidE[0] + '.' + hidE[1] + '.' + hidE[2];
			                    if (stateId.match(/Red\d?/)) {
			                        // set red component
			                        if (state.val > 100) state.val = 100;
			                        const red = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
			                        const idAlive = deviceDesc + '.Color';
			                        adapter.getForeignState(idAlive, function (err, state) {
			                            if (!state) {
			                                adapter.setState(idAlive, '#000000', false);
			                                return;
			                            }
			                            const color = state.val.substring(1);
			                            // replace red component
			                            const out = red + color.substring(2, 10);
			                            adapter.setState(idAlive,'#' + out, false);
			                            setColor(channelId, out);
			                        });
			                    } else
			                    if (stateId.match(/Green\d?/)) {
			                        // set green component
			                        if (state.val > 100) state.val = 100;
			                        const green = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
			                        const idAlive = deviceDesc + '.Color';
			                        adapter.getForeignState(idAlive, function (err, state) {
			                            if (!state) {
			                                adapter.setState(idAlive, '#000000', false);
			                                return;
			                            }
			                            const color = state.val.substring(1);
			                            // replace green component
			                            const out = color.substring(0, 2) + green + color.substring(4, 10);
			                            adapter.setState(idAlive,'#' + out, false);
			                            setColor(channelId, out);
			                        });
			                    } else
			                    if (stateId.match(/Blue\d?/)) {
			                        // set blue component
			                        if (state.val > 100) state.val = 100;
			                        const blue = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
			                        const idAlive = deviceDesc + '.Color';
			                        adapter.getForeignState(idAlive, function (err, state) {
			                            if (!state) {
			                                adapter.setState(idAlive, '#000000', false);
			                                return;
			                            }
			                            const color = state.val.substring(1);
			                            // replace blue component
			                            const out = color.substring(0, 4) + blue + color.substring(6, 10);
			                            adapter.setState(idAlive,'#' + out, false);
			                            setColor(channelId, out);
			                        });
			                    } else
			                    if (stateId.match(/RGB_POWER\d?/)) {
			                        // set ww component
			                        const rgbpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
			                        const idAlive = deviceDesc + '.Color';
			                        adapter.getForeignState(idAlive, function (err, state) {
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
			                            var out = rgb + color.substring(6, 10);
										
										if ((rgbpow === true) && (ledflags&1)) {
											//adapter.log.info('reset white');
											out = rgb + '0000';
											let idAlive = deviceDesc + '.WW_POWER';
											adapter.setState(idAlive,false, false);
											idAlive = deviceDesc + '.WW';
											adapter.setState(idAlive,0, false);
											idAlive = deviceDesc + '.CW_POWER';
											adapter.setState(idAlive,false, false);
											idAlive = deviceDesc + '.CW';
											adapter.setState(idAlive,0, false);
										}
			                            setColor(channelId, out);
										adapter.setState(idAlive,'#' + out, false);
			                            if (rgbpow === true) {
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
			                        adapter.getForeignState(idAlive, function (err, state) {
			                            if (!state) {
			                                const dim = 100;
			                                adapter.setState(idAlive, dim, true);
			                                //adapter.log.warn('ill state Dimmer');
			                            } else {
			                                const dim = state.val;
			                                let idAlive = deviceDesc + '.Saturation';
			                                adapter.getForeignState(idAlive, function (err, state) {
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
			                        let idAlive = deviceDesc + '.Dimmer';
			                        adapter.getForeignState(idAlive, function (err, state) {
			                            if (!state) {
			                                const dim = 100;
			                                adapter.setState(idAlive, dim, true);
			                                //adapter.log.warn('ill state Dimmer');
			                            } else {
			                                const dim = state.val;
			                                let idAlive = deviceDesc + '.Hue';
			                                adapter.getForeignState(idAlive, function (err, state) {
			                                    if (!state) {
			                                        const hue = 100;
			                                        adapter.setState(idAlive, hue, true);
			                                    } else {
			                                        const hue = state.val;
			                                        const rgb = hsvToRgb(hue, sat, dim);
			                                        const hexval = componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
			                                        let idAlive = deviceDesc + '.Color';
			                                        adapter.setState(idAlive, '#' + hexval, false);
			                                    }
			                                });
			                            }
			                        });
			                    } else {						                               
			                        // get color attributes to check other ledstripe vars
			                        const idAlive = deviceDesc + '.Color';
			                        adapter.getForeignObject(idAlive, function (err, obj) {
			                            if (!obj) {
			                                // no color object
			                                adapter.log.warn('unknown setstate object: ' + id + ' : ' + state);
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
			                                    adapter.getForeignState(idAlive, function (err, state) {
			                                        if (!state) {
			                                            adapter.log.warn('ill state Color');
			                                            return;
			                                        }
			                                        const color = state.val.substring(1);
			                                        let ww = '00';
			                                        if (wwpow === true) {
			                                            ww = 'FF';
			                                        }
			                                        // replace ww component
			                                        var out = color.substring(0, wwindex) + ww;
													if ((wwpow === true) && (ledflags&1)) {
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
			                                        if (wwpow === true) {
			                                            setPower(channelId, true)
			                                        }
			                                    });
			                                } else
			                                if (stateId.match(/CW_POWER\d?/)) {
			                                    // set ww component
			                                    const cwpow = state.val === 'true' || state.val === true || state.val === 1 || state.val === '1';
			                                    const idAlive = deviceDesc + '.Color';
			                                    adapter.getForeignState(idAlive, function (err, state) {
			                                        if (!state) {
			                                            adapter.log.warn('ill state Color');
			                                            return;
			                                        }
			                                        const color = state.val.substring(1);
			                                        let cw = '00';
			                                        if (cwpow === true) {
			                                            cw = 'FF';
			                                        }
			                                        // replace cw component
			                                        const out = color.substring(0, 6) + cw + color.substring(8, 10);
													let idAlive = deviceDesc + '.Color';
													adapter.setState(idAlive,'#' + out, false);
			                                        setColor(channelId, out);
										
													// set cw channel
													idAlive = deviceDesc + '.CW';
													adapter.setState(idAlive, 100 * parseInt(out.substring(6, 8), 16) / 255, true);
										
			                                        // in case POWER is off, switch it on
			                                        if (cwpow === true) {
			                                            let idAlive = deviceDesc + '.POWER';
			                                            adapter.setState(idAlive, true, false);
			                                        }
			                                    });
			                                } else
			                                if (stateId.match(/WW\d?/)) {
			                                    // set ww component
			                                    const ww = toPaddedHexString(Math.floor(255 * state.val / 100), 2);
			                                    const idAlive = deviceDesc + '.Color';
			                                    adapter.getForeignState(idAlive, function (err, state) {
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
			                                    adapter.getForeignState(idAlive, function (err, state) {
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
					});
				}
            } else {
				
                //Client:"DVES_96ABFA : MagicHome" not connected => State: sonoff.0.myState - Value: 0, ack: false, time stamp: 1520369614189, last changed: 1520369614189
                // if (server && state && !state.ack) {
                // server = false
                // or state = false
                // or state.ack = true
                // or clients[channelId] = false
                adapter.log.warn('Client "' + channelId + '" not connected');

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
                adapter.getForeignObject(task.id, (err, obj) => {
                    if (!obj) {
                        adapter.setForeignObject(task.id, task.data, (/* err */) => {
                            tasks.shift();
                            setImmediate(processTasks);
                        });
                    } else {
                        tasks.shift();
                        setImmediate(processTasks);
                    }
                });
            } else if (task.type === 'extendObject') {
                adapter.extendObject(task.id, task.data, (/* err */) => {
                    tasks.shift();
                    setImmediate(processTasks);
                });
            } else if (task.type === 'deleteState') {
                adapter.deleteState('', '', task.id, (/* err */) => {
                    tasks.shift();
                    setImmediate(processTasks);
                });
            } else {
                adapter.log.error('Unknown task name: ' + JSON.stringify(task));
                tasks.shift();
                setImmediate(processTasks);
            }
        }
    }

    function createClient(client) {
        // mqtt.0.cmnd.sonoff.POWER
        // mqtt.0.stat.sonoff.POWER
        let isStart = !tasks.length;

        let id = adapter.namespace + '.' + client.id;
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
                role: 'indicator.connected',
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
        let idAlive = adapter.namespace + '.' + client.id + '.alive';

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

        adapter.log.debug('Send to "' + client.id + '": ' + topic + ' = ' + state);
        client.publish({topic: topic, payload: state, qos: qos, retain: retain, messageId: messageId++}, cb);
        messageId &= 0xFFFFFFFF;
    }

    function sendLWT(client, cb) {
        if (client && client._will && client._will.topic) {
            sendState2Client(client, client._will.topic, client._will.payload, client._will.qos, client._will.retain, cb);
        } else {
            cb && cb();
        }
    }


    function addObject(attr, client, prefix, path) {
        let replaceAttr = types[attr].replace || attr;
        let id = adapter.namespace + '.' + client.id + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr.replace(/[-.+\s]+/g, '_');
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
        return [obj, id];
    }
	
    function pushObject(id,obj) {
		adapter.getObject(id, function (err,xobj) {
			if (!xobj) {
            	adapter.setForeignObject(obj.id,obj.data, (/* err */) => {
					adapter.log.info("new object created: " + id);
            	});
			}
		});
    }
	
    function checkData(client, topic, prefix, data, unit, path) {
		
		 
        if (!data || typeof data !== 'object') return;
        path = path || [];
        prefix = prefix || '';

        // first get the units
        if (data.TempUnit) {
            unit = data.TempUnit;
            if (unit.indexOf('°') !== 0) {
                unit = '°' + unit.replace('°');
            }
        }
		

        for (let attr in data) {

		    if (!data.hasOwnProperty(attr)) continue;
			
            if (typeof data[attr] === 'object') {
				
				// check for arrays
				if (types[attr]) {
					if (types[attr].type==='array') {
						// transform to array of attributes
						for (let i=1; i <=10; i++) {
							let val=data[attr][i-1];
							if (typeof val == 'undefined') break;
							// define new object
			                let replaceAttr = attr + i.toString();
			                let id = adapter.namespace + '.' + client.id + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr;
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
							//tasks.push(obj);
							pushObject(id,obj);
							adapter.setState(id,val, true);
						}
					} else {
	                	let nPath = Object.assign([], path);
	                	nPath.push(attr.replace(/[-.+\s]+/g, '_'));
	                	checkData(client, topic, prefix, data[attr], unit, nPath);
					}
				} else {
                	let nPath = Object.assign([], path);
                	nPath.push(attr.replace(/[-.+\s]+/g, '_'));
                	checkData(client, topic, prefix, data[attr], unit, nPath);
				}
            } else if (types[attr]) {

				// create object
				let cobj=addObject(attr, client, prefix, path)
				let obj=cobj[0];
				let id=cobj[1];
				
                let replaceAttr = types[attr].replace || attr;
                
                if (attr === 'Temperature') {
                    obj.data.common.unit = unit || obj.data.common.unit || '°C';
                }
                if (obj.data.common.storeMap) {
                    delete obj.data.common.storeMap;
                    client._map[replaceAttr] = topic.replace(/$\w+\//, 'cmnd/').replace(/\/\w+$/, '/' + replaceAttr);
                }
				

                // adaptions for magichome tasmota
                if (attr === 'Color') {
					
					/*
			        let idAlive = adapter.namespace + '.' + client.id + '.LED_Mode';
			        adapter.getForeignState(idAlive, (err, state) => {
						var ledflags=1;
			            if (state) {
			            	var ledflags=state.val;
			            }
						
			        });*/
					// read vars
					// if ledflags bit 2, read color from tasmota, else ignore
					var ledflags=0;
					
                    if (data[attr].length === 10) {
                        obj.data.common.role = 'level.color.rgbcwww';
                    } else if (data[attr].length === 8) {
                        obj.data.common.role = 'level.color.rgbww';
                    } else {
                        obj.data.common.role = 'level.color.rgb';
                    }
                    //tasks.push(obj);
					pushObject(id,obj);
					
					//adapter.log.info('READ color :' + data[attr]);

					
                    if (hueCalc) {
                        let xobj = addObject('Hue', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);

                        xobj = addObject('Saturation', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);

                        xobj = addObject('Red', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);
                        if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(0, 2), 16) / 255, true);

                        xobj = addObject('Green', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);
                        if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(2, 4), 16) / 255, true);

                        xobj = addObject('Blue', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);
                        if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(4, 6), 16) / 255, true);


                        xobj = addObject('RGB_POWER', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);
                        let val = parseInt(data[attr].substring(0, 6), 16);
                        if (val > 0) {
                           if (ledflags&2) adapter.setState(xobj[1], true, true);
                        } else {
                           if (ledflags&2) adapter.setState(xobj[1], false, true);
                        }
						
				        let idAlive = adapter.namespace + '.' + client.id + '.LED_Mode';
				        adapter.getForeignState(idAlive, (err, state) => {
				            if (!state) {
								//initialisation 
		                        xobj = addObject('LED_Mode', client, prefix, path);
		                        //tasks.push(xobj[0]);
								pushObject(xobj[1],xobj[0]);
								adapter.setState(xobj[1],1, true);
				            }
				        });
                        xobj = addObject('LED_Mode', client, prefix, path);
                        //tasks.push(xobj[0]);
						pushObject(xobj[1],xobj[0]);
                       // adapter.setState(xobj[1],1, true);

                        if (obj.data.common.role === 'level.color.rgbww') {
                            // rgbww
                            xobj = addObject('WW', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(6, 8), 16) / 255, true);

                            xobj = addObject('WW_POWER', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            val = parseInt(data[attr].substring(6, 8), 16);
                            if (val > 0) {
                              if (ledflags&2) adapter.setState(xobj[1], true, true);
                            } else {
                              if (ledflags&2) adapter.setState(xobj[1], false, true);
                            }
                        }
                        if (obj.data.common.role === 'level.color.rgbcwww') {
                            //adapter.log.info(obj.data.common.role);
                            // rgbcwww
                            xobj = addObject('CW', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(6, 8), 16) / 255, true);

                            xobj = addObject('CW_POWER', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            val = parseInt(data[attr].substring(6, 8), 16);
                            if (val > 0) {
                               if (ledflags&2) adapter.setState(xobj[1], true, true);
                            } else {
                               if (ledflags&2) adapter.setState(xobj[1], false, true);
                            }
                            xobj = addObject('WW', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            if (ledflags&2) adapter.setState(xobj[1], 100 * parseInt(data[attr].substring(8, 10), 16) / 255, true);

                            xobj = addObject('WW_POWER', client, prefix, path);
                            //tasks.push(xobj[0]);
							pushObject(xobj[1],xobj[0]);
                            val = parseInt(data[attr].substring(8, 10), 16);
                            if (val > 0) {
                               if (ledflags&2) adapter.setState(xobj[1], true, true);
                            } else {
                               if (ledflags&2) adapter.setState(xobj[1], false, true);
                            }
                        }

                    }

                } else {
					// push only new objects
					pushObject(id,obj);
                }

                if (tasks.length === 1) {
                    processTasks();
                }

                if (obj.data.common.type === 'number') {
                    adapter.setState(id, parseFloat(data[attr]), true);
                } else if (obj.data.common.type === 'boolean') {
                    adapter.setState(id, (data[attr] || '').toUpperCase() === 'ON', true);
                } else {
                    if (attr === 'Color') {
                        // add # char
                        const color = '#' + data[attr];
                        if (ledflags&2) adapter.setState(id, color, true);
                    } else {
                        adapter.setState(id, data[attr], true);
                    }
                }
            }
			else {
				// not in list, auto insert
				//adapter.log.warn('[' + client.id + '] Received attr not in list: ' + attr + data[attr]);
		        let parts = topic.split('/');
				if (parts[0]==='tele' && parts[2]==='SENSOR') {
					if (data[attr]) {
						//adapter.log.info('[' + client.id + '] auto insert tele SENSOR object: ' + attr + ' ' + data[attr]);
						var attributes;
						if (data[attr].isNaN) {
							// string 
							attributes="{type:'string',role:'value',read:true,write:false}"
						} else {
							// number
							attributes="{type:'number',role:'value',read:true,write:false}"
						}
                		let replaceAttr = attr ;
                		let id = adapter.namespace + '.' + client.id + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '') + replaceAttr;
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
						//tasks.push(obj);
						pushObject(id,obj);
						adapter.setState(id,data[attr], true);
					}
				}
			}
        }
    }

    function receivedTopic(packet, client) {
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

        if (!client._fallBackName) {
            let parts = packet.topic.split('/');
            client._fallBackName = parts[1];
        }

        let parts = packet.topic.split('/');
        let stateId = parts.pop();

        if (stateId === 'LWT') {
            return;
        }

        if (stateId === 'RESULT') {
            // ignore: stat/Sonoff/RESULT = {"POWER":"ON"}
            // testserver.js reports error, so reject above cmd
            const str = val.replace(/\s+/g, '');
            if (str.startsWith('{"POWER":"ON"}')) return;
            if (str.startsWith('{"POWER":"OFF"}')) return;

            if (parts[0] === 'stat') {
                try {
                    checkData(client, packet.topic, NO_PREFIX, JSON.parse(val));
                } catch (e) {
                    adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
                }
				return;
            }
            if (parts[0] === 'tele') {
                try {
                    checkData(client, packet.topic, NO_PREFIX, JSON.parse(val));
                } catch (e) {
                    adapter.log.warn('Cannot parse data "' + stateId + '": _' + val + '_ - ' + e);
                }
            }
            return;
        }

        // tele/sonoff_4ch/STATE = {"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}
        // tele/sonoff/SENSOR    = {"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}
        // tele/sonoff5/SENSOR   = {"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}
        // tele/sonoff/SENSOR    = {"Time":"2018-02-23T17:36:59", "Analog0":298}
        if (parts[0] === 'tele' && stateId.match(/^(STATE|SENSOR|WAKEUP)\d?$/)) {
            try {
                checkData(client, packet.topic, NO_PREFIX, JSON.parse(val));
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
                let id = adapter.namespace + '.' + client.id + '.' + stateId.replace(/[-.+\s]+/g, '_');
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
				pushObject(id,obj);
				
                //tasks.push(obj);

                if (tasks.length === 1) {
                    processTasks();
                }

                if (parts[0] === 'cmnd') {

                    // Set Object fix
                    if (obj.data.common.type === 'number') {
                        adapter.setState(id, parseFloat(val), true);
                    } else if (obj.data.common.type === 'boolean') {
                        adapter.setState(id, val === 'ON' || val === '1' || val === 'true' || val === 'on', true);
                    } else {
                        adapter.setState(id, val, true);
                    }

                    // remember POWER topic
                    client._map[stateId] = packet.topic;
                } else {
                    if (obj.data.common.type === 'number') {
                        adapter.setState(id, parseFloat(val), true);
                    } else if (obj.data.common.type === 'boolean') {
                        adapter.setState(id, val === 'ON' || val === '1' || val === 'true' || val === 'on', true);
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

        if (client._sendOnStart) {
            clearTimeout(client._sendOnStart);
            client._sendOnStart = null;
        }
        try {
            if (clients[client.id] && (client.timestamp === clients[client.id].timestamp)) {
                adapter.log.info('Client [' + client.id + '] ' + reason);
                delete clients[client.id];
                updateAlive(client, false);
                updateClients();
                sendLWT(client, () => {
                    client.destroy();
                });
            } else {
                client.destroy();
            }
        } catch (e) {
            adapter.warn('Cannot close client: ' + e);
        }
    }

    const _constructor = (config => {
        if (config.timeout === undefined) {
            config.timeout = 300;
        } else {
            config.timeout = parseInt(config.timeout, 10);
        }

        server.on('connection', stream => {
            let client = mqtt(stream);
            // client connected
            client.on('connect', function (options) {
                // acknowledge the connect packet
                client.id = options.clientId;
                // store unique timestamp with each client
                client.timestamp = new Date().getTime();

                // get possible old client
                let oldClient = clients[client.id];


                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== options.password.toString()) {
                        adapter.log.warn('Client [' + options.clientId + '] has invalid password(' + options.password + ') or username(' + options.username + ')');
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
                    adapter.log.info('Client [' + client.id + '] reconnected');
                    // need to destroy the old client
                    oldClient.destroy();
                } else {
                    adapter.log.info('Client [' + client.id + '] connected');
                }


                client.connack({returnCode: 0});
                clients[client.id] = client;
                updateClients();

                if (options.will) { //  the client's will message options. object that supports the following properties:
                    // topic:   the will topic. string
                    // payload: the will payload. string
                    // qos:     will qos level. number
                    // retain:  will retain flag. boolean
                    client._will = options.will;
                }
                createClient(client);
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
                receivedTopic(packet, client);
            });

            client.on('subscribe', packet => {
                let granted = [];
                // just confirm the request.
                // we expect subscribe for 'cmnd.sonoff.#'
                for (let i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', (/*packet*/) => {
                if (clients[client.id] && (client.timestamp === clients[client.id].timestamp)) {
                    adapter.log.debug('Client [' + client.id + '] pingreq');
                    client.pingresp();
                } else {
                    adapter.log.info('Received pingreq from disconnected client "' + client.id + '"');
                }
            });
        });

        config.port = parseInt(config.port, 10) || 1883;

        // Update connection state
        updateClients();

        // to start
        server.listen(config.port, config.bind, () => {
            adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + ' server on port ' + config.port);
        });
    })(adapter.config);

    return this;
}

module.exports = MQTTServer;
