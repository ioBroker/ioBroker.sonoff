'use strict';

let createStreamServer = require(__dirname + '/streamServer');
let mqtt               = require('mqtt-connection');

function MQTTServer(adapter) {
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter);

    let server  = null;
    let clients = {};
    let tasks   = [];

    this.destroy = function (cb) {
        if (server) {
            let cnt = 0;
            for (let id in clients) {
                if (clients.hasOwnProperty(id)) {
                    cnt++;
                    adapter.setForeignState(adapter.namespace + '.' + clients[id].id + '.alilve', false, true, function () {
                        if (!--cnt) {
                            // to release all resources
                            server.destroy(function () {
                                cb && cb();
                            });
                            server = null;
                        }
                    });
                }
            }
            if (!cnt) {
                // to release all resources
                server.destroy(function () {
                    cb && cb();
                });
                server = null;
            }
        }
    };
    
    this.onStateChange = function (id, state) {
        adapter.log.debug('onStateChange ' + id + ': ' + JSON.stringify(state));
        if (server && state && !state.ack) {
            // find client.id
            let parts = id.split('.');
            let stateId = parts.pop();
            let channelId = parts.pop();
            if (clients[channelId]) {
                if (stateId.match(/POWER\d?/)) {
                    if (clients[channelId]._map[stateId]) {
                        setImmediate(sendState2Client, clients[channelId], clients[channelId]._map[stateId] || 'cmnd/sonoff/POWER', state.val ? 'ON' : 'OFF');
                    } else if (clients[channelId]._fallBackName) {
                        setImmediate(sendState2Client, clients[channelId], 'cmnd/' + clients[channelId]._fallBackName + '/' + stateId, state.val ? 'ON' : 'OFF');
                    } else {
                        adapter.log.warn('Unknown mapping for "' + stateId + '"');
                    }
                }
            } else {
                adapter.log.warn('Client "' + channelId + '" not connected');
            }
        }
    };

    function processTasks() {
        if (tasks && tasks.length) {
            let task = tasks.shift();
            if (task.type === 'addObject') {
                adapter.getForeignObject(task.id, function (err, obj) {
                    if (!obj) {
                        adapter.setForeignObject(task.id, task.data, function (/* err */) {
                            setImmediate(processTasks);
                        });
                    } else {
                        setImmediate(processTasks);
                    }
                });
            } else
            if (task.type === 'extendObject') {
                adapter.extendObject(task.id, task.data, function (/* err */) {
                    setImmediate(processTasks);
                });
            } else if (task.type === 'deleteState') {
                adapter.deleteState('', host, task.id, function (/* err */) {
                    setImmediate(processTasks);
                });
            } else {
                adapter.log.error('Unknown task name: ' + JSON.stringify(task));
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
    
    function sendState2Client(client, topic, state, qos, retain, cb) {
        if (typeof qos === 'function') {
            cb  = qos;
            qos = undefined;
        }

        adapter.log.debug('Send to "' + client.id + '": ' + topic + ' = ' + state);
        client.publish({topic: topic, payload: state, qos: qos, retain: retain}, cb);
    }

    function sendLWT(client, cb) {
        if (client && client._will) {
            sendState2Client(client, client._will.topic, client._will.payload, client._will.qos, client._will.retain, cb);
        } else {
            cb && cb();
        }
    }

    let supportedStates = [
        'Vcc'
    ];
    function receivedTopic(packet, client) {
        client.states = client.states || {};
        client.states[packet.topic] = {
            message: packet.payload,
            retain: packet.retain,
            qos: packet.qos
        };

        // Update alive state
        let idAlive = adapter.namespace + '.' + client.id + '.alive';

        adapter.getForeignState(idAlive, function (err, state) {
            if (!state || !state.val) {
                adapter.setForeignState(idAlive, true, true);
            }
        });

        if (packet.topic === client._will.topic) {
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
        let id;
        if (!client._fallBackName) {
            let parts = packet.topic.split('/');
            client._fallBackName = parts[1];
        }

        // cmnd/sonoff/POWER
        // stat/sonoff/POWER
        if (packet.topic.match(/^(stat|cmnd)\/.+\/POWER\d?$/)) {
            let parts = packet.topic.split('/');
            let stateId = parts.pop();

            id = adapter.namespace + '.' + client.id + '.' + stateId;

            tasks.push({
                type: 'addObject',
                id: id,
                data: {
                    _id: id,
                    common: {
                        name: client.id + ' ' + stateId,
                        type: 'boolean',
                        role: 'switch',
                        read: true,
                        write: true
                    }, native: {},
                    type: 'state'
                }
            });

            if (tasks.length === 1) {
                processTasks();
            }
            if (packet.topic.match(/^stat\//)) {
                adapter.setState(id, val === 'ON', true);
            } else if (packet.topic.match(/^cmnd\//)) {
                // remember POWER topic
                client._map[stateId] = packet.topic;
            }
        } else if (packet.topic.match(/^tele\/.+\/STATE\d?$/)) {
            try {
                let data = JSON.parse(val);
                if (data.Vcc) {
                    id = adapter.namespace + '.' + client.id + '.Vcc';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' voltage',
                                type: 'number',
                                unit: 'V',
                                role: 'value.voltage',
                                read: true,
                                write: false
                            }, native: {},
                            type: 'state'
                        }
                    });

                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, parseFloat(data.Vcc), true);
                }
                // Vcc,
                // Wifi.RSSI
                if (data.Wifi && data.Wifi.RSSI) {
                    id = adapter.namespace + '.' + client.id + '.RSSI';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' RSSI',
                                type: 'number',
                                role: 'value.rssi',
                                read: true,
                                write: false
                            }, native: {},
                            type: 'state'
                        }
                    });

                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, parseFloat(data.Wifi.RSSI), true);
                }

                if (data.POWER) {
                    id = adapter.namespace + '.' + client.id + '.POWER';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' POWER',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, data.POWER === 'ON', true);
                    client._map.POWER = packet.topic.replace(/$tele\//, 'cmnd/').replace(/\/STATE$/, '/POWER');
                }

                if (data.POWER1) {
                    id = adapter.namespace + '.' + client.id + '.POWER1';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' POWER1',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, data.POWER1 === 'ON', true);
                    client._map.POWER1 = packet.topic.replace(/^tele\//, 'cmnd/').replace(/\/STATE$/, '/POWER1');
                }

                if (data.POWER2) {
                    id = adapter.namespace + '.' + client.id + '.POWER2';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' POWER2',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, data.POWER2 === 'ON', true);
                    client._map.POWER2 = packet.topic.replace(/^tele\//, 'cmnd/').replace(/\/STATE$/, '/POWER2');
                }

                if (data.POWER3) {
                    tasks.push({
                        type: 'addObject', id: adapter.namespace + '.POWER3', data: {
                            common: {
                                name: client.id + ' POWER3',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(adapter.namespace + '.' + client.id + '.POWER3', data.POWER3 === 'ON', true);
                    client._map.POWER3 = packet.topic.replace(/^tele\//, 'cmnd/').replace(/\/STATE$/, '/POWER3');
                }

                if (data.POWER4) {
                    id = adapter.namespace + '.' + client.id + '.POWER4';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' POWER4',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, data.POWER4 === 'ON', true);
                    client._map.POWER4 = packet.topic.replace(/^tele\//, 'cmnd/').replace(/\/STATE$/, '/POWER4');
                }
            } catch (e) {
                adapter.log.warn('Cannot parse data: ' + val);
            }
        } else if (packet.topic.match(/^tele\/.+\/SENSOR\d?$/)) {
            try {
                let data = JSON.parse(val);
                if (data.DS18B20 && data.DS18B20.Temperature !== undefined) {
                    id = adapter.namespace + '.' + client.id + '.DS18B20_Temperature';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' DS18B20 Temperature',
                                type: 'number',
                                unit: data.TempUnit ? (data.TempUnit.indexOf('°') !== -1 ? '°' + data.TempUnit : data.TempUnit) : '°C',
                                role: 'value.temperature',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, parseFloat(data.DS18B20.Temperature), true);
                }
                if (data.DS18B20 && data.DS18B20.Humidity !== undefined) {
                    id = adapter.namespace + '.' + client.id + '.DS18B20_Humidity';
                        tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' DS18B20 Humidity',
                                type: 'number',
                                unit: '%',
                                role: 'value.humidity',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, parseFloat(data.DS18B20.Humidity), true);
                }

                if (data.Switch1) {
                    // Switch1 = POWER2
                    id = adapter.namespace + '.' + client.id + '.POWER2';
                    tasks.push({
                        type: 'addObject',
                        id: id,
                        data: {
                            _id: id,
                            common: {
                                name: client.id + ' POWER2',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }, native: {},
                            type: 'state'
                        }
                    });
                    if (tasks.length === 1) {
                        processTasks();
                    }
                    adapter.setState(id, data.Switch1 === 'ON', true);
                }
            } catch (e) {
                adapter.log.warn('Cannot parse data: ' + val);
            }
        }
    }

    let _constructor = (function (config) {
        let cltFunction = function (client) {

            client.on('connect', function (options) {
                client.id = options.clientId;

                if (config.user) {
                    if (config.user !== options.username ||
                        config.pass !== options.password.toString()) {
                        adapter.log.warn('Client [' + options.clientId + '] has invalid password(' + options.password + ') or username(' + options.username + ')');
                        client.connack({returnCode: 4});
                        if (clients[client.id]) {
                            delete clients[client.id];
                        }
                        client.stream.end();
                        updateClients();
                        return;
                    }
                }

                adapter.log.info('Client [' + options.clientId + '] connected');

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

            client.on('publish', function (packet) {
                receivedTopic(packet, client);
            });

            client.on('subscribe', function (packet) {
                var granted = [];
                // just confirm the request.
                // we expect subscribe for 'cmnd.sonoff.#'
                for (var i = 0; i < packet.subscriptions.length; i++) {
                    granted.push(packet.subscriptions[i].qos);
                }

                client.suback({granted: granted, messageId: packet.messageId});
            });

            client.on('pingreq', function (/*packet*/) {
                adapter.log.debug('Client [' + client.id + '] pingreq');
                client.pingresp();
            });

            client.on('disconnect', function (/*packet*/) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.info('Client [' + client.id + '] disconnected');
                client.stream.end();
                if (clients[client.id]) {
                    delete clients[client.id];
                    sendLWT(client);
                    updateClients();
                }
            });

            client.on('close', function (had_error) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                if (had_error) adapter.log.error('Closed because of error');
                adapter.log.info('Client [' + client.id + '] closed');
                if (clients[client.id]) {
                    delete clients[client.id];
                    sendLWT(client);
                    updateClients();
                }
            });

            client.on('error', function (err) {
                if (client._sendOnStart) {
                    clearTimeout(client._sendOnStart);
                    client._sendOnStart = null;
                }
                adapter.log.warn('Client error [' + client.id + ']: ' + err);

                if (!clients[client.id]) return;

                delete clients[client.id];
                sendLWT(client, function () {
                    updateClients();
                    client.stream.end();
                });
            });
        };

        config.port = parseInt(config.port, 10) || 1883;

        // create connected object and state
        adapter.getObject('info.connection', function (err, obj) {
            if (!obj || !obj.common || obj.common.type !== 'string') {
                obj = {
                    _id:  'info.connection',
                    type: 'state',
                    common: {
                        role:  'info.clients',
                        name:  'List of connected clients',
                        type:  'string',
                        read:  true,
                        write: false,
                        def:   false
                    },
                    native: {}
                };

                adapter.setObject('info.connection', obj, function () {
                    updateClients();
                });
            } else {
                updateClients();
            }
        });

        server = createStreamServer({
            port: config.port,
            host: config.bind
        }, function (clientStream) {
            cltFunction(mqtt(clientStream, {
                notData: false
            }));
        });

        // to start
        server.listen(function () {
            adapter.log.info('Starting MQTT ' + (config.user ? 'authenticated ' : '') + ' server on port ' + config.port);
        });
    })(adapter.config);
    
    return this;
}

module.exports = MQTTServer;