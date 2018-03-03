/* jshint -W097 */
// jshint strict:true
/*jslint node: true */
/*jslint esversion: 6 */
'use strict';

let createStreamServer = require(__dirname + '/streamServer');
let mqtt               = require('mqtt-connection');

function MQTTServer(adapter) {
    if (!(this instanceof MQTTServer)) return new MQTTServer(adapter);

    const NO_PREFIX = '';

    let server    = null;
    let clients   = {};
    let tasks     = [];
    let messageId = 1;

    this.destroy = function (cb) {
        if (server) {
            let cnt = 0;
            for (let id in clients) {
                if (clients.hasOwnProperty(id)) {
                    cnt++;
                    adapter.setForeignState(adapter.namespace + '.' + clients[id].id + '.alive', false, true, function () {
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
            let task = tasks[0];
            if (task.type === 'addObject') {
                adapter.getForeignObject(task.id, function (err, obj) {
                    if (!obj) {
                        adapter.setForeignObject(task.id, task.data, function (/* err */) {
                            tasks.shift();
                            setImmediate(processTasks);
                        });
                    } else {
                        tasks.shift();
                        setImmediate(processTasks);
                    }
                });
            } else
            if (task.type === 'extendObject') {
                adapter.extendObject(task.id, task.data, function (/* err */) {
                    tasks.shift();
                    setImmediate(processTasks);
                });
            } else if (task.type === 'deleteState') {
                adapter.deleteState('', '', task.id, function (/* err */) {
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

    function sendState2Client(client, topic, state, qos, retain, cb) {
        if (typeof qos === 'function') {
            cb  = qos;
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

    const types = {
        Temperature:   {type: 'number',  role: 'value.temperature',        read: true, write: false, unit: '°C'},
        Humidity:      {type: 'number',  role: 'value.humidity',           read: true, write: false, unit: '%'},
        Temperatur:    {type: 'number',  role: 'value.temperature',        read: true, write: false, unit: '°C'},
        Feuchtigkeit:  {type: 'number',  role: 'value.humidity',           read: true, write: false, unit: '%'},
        Vcc:           {type: 'number',  role: 'value.voltage',            read: true, write: false, unit: 'V'},
        VCC:           {type: 'number',  role: 'value.voltage',            read: true, write: false, unit: 'V'},
	    Laufzeit:      {type: 'number',  role: 'value.duration',           read: true, write: false, unit: 'hours'}, /// ?
        RSSI:          {type: 'number',  role: 'value.rssi',               read: true, write: false},
        POWER:         {type: 'boolean', role: 'switch',                   read: true, write: true,  storeMap: true},
        POWER1:        {type: 'boolean', role: 'switch',                   read: true, write: true,  storeMap: true},
        POWER2:        {type: 'boolean', role: 'switch',                   read: true, write: true,  storeMap: true},
        POWER3:        {type: 'boolean', role: 'switch',                   read: true, write: true,  storeMap: true},
        POWER4:        {type: 'boolean', role: 'switch',                   read: true, write: true,  storeMap: true},
		Switch1:       {type: 'boolean', role: 'switch',                   read: true, write: false},
		Switch2:       {type: 'boolean', role: 'switch',                   read: true, write: false},
        Total:         {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'kWh'},
        Today:         {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'kWh'},
        heute:         {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'kWh'},
        Yesterday:     {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'kWh'},
        gestern:       {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'kWh'},
        Faktor:        {type: 'number',  role: 'value',                    read: true, write: false},
        Factor:        {type: 'number',  role: 'value',                    read: true, write: false},
        Power:         {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'W'},
        Leistung:      {type: 'number',  role: 'value.power.consumption',  read: true, write: false, unit: 'W'},
        Voltage:       {type: 'number',  role: 'value.voltage',            read: true, write: false, unit: 'V'},
        Spannung:      {type: 'number',  role: 'value.voltage',            read: true, write: false, unit: 'V'},
        Current:       {type: 'number',  role: 'value.current',            read: true, write: false, unit: 'A'},
        Strom:         {type: 'number',  role: 'value.current',            read: true, write: false, unit: 'A'},
        Punkt:         {type: 'number',  role: 'value',                    read: true, write: false, unit: '?'}, /// ?
        Counter1:      {type: 'number',  role: 'value',                    read: true, write: false},
        Counter2:      {type: 'number',  role: 'value',                    read: true, write: false},
        Counter3:      {type: 'number',  role: 'value',                    read: true, write: false},
        Counter4:      {type: 'number',  role: 'value',                    read: true, write: false},
        Pressure:      {type: 'number',  role: 'value.pressure',           read: true, write: false, unit: 'P'},
        Druck:         {type: 'number',  role: 'value.pressure',           read: true, write: false, unit: 'P'},
        'Approx. Altitude': {type: 'number',  role: 'value.altitude',      read: true, write: false, unit: 'm'},
        Module:        {type: 'string',  role: 'state',                    read: true, write: false},
        Version:       {type: 'string',  role: 'state',                    read: true, write: false},
        Hostname:      {type: 'string',  role: 'state',                    read: true, write: false},
        IPAddress:     {type: 'string',  role: 'state',                    read: true, write: false},
        IPaddress:     {type: 'string',  role: 'state',                    read: true, write: false},
        RestartReason: {type: 'string',  role: 'state',                    read: true, write: false},
        CarbonDioxide: {type: 'number',  role: 'value.CO2',                read: true, write: false, unit: 'ppm'},
        Illuminance:   {type: 'number',  role: 'value.illuminance',        read: true, write: false, unit: 'lx'},
        Analog0:       {type: 'number',  role: 'value',                    read: true, write: false},
        Analog1:       {type: 'number',  role: 'value',                    read: true, write: false},
        Analog2:       {type: 'number',  role: 'value',                    read: true, write: false},
        Analog3:       {type: 'number',  role: 'value',                    read: true, write: false}
    };

    function checkData(client, topic, prefix, data, unit, path) {
        if (!data || typeof data !== 'object') return;
        path   = path || [];
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
                let nPath = Object.assign([], path);
                nPath.push(attr.replace(/[-.+\s]+/g, '_'));
                checkData(client, topic, prefix, data[attr], unit, nPath);
            } else
            if (types[attr]) {

                let replaceAttr = types[attr].replace || attr;
                let id = adapter.namespace + '.' + client.id + '.' + (prefix ? prefix + '.' : '') + (path.length ? path.join('_') + '_' : '')  + replaceAttr.replace(/[-.+\s]+/g, '_');
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

                if (attr === 'Temperature') {
                    obj.data.common.unit = unit || obj.data.common.unit || '°C';
                }
                if (obj.data.common.storeMap) {
                    delete obj.data.common.storeMap;
                    client._map[replaceAttr] = topic.replace(/$\w+\//, 'cmnd/').replace(/\/\w+$/, '/' + replaceAttr);
                }

                tasks.push(obj);
                if (tasks.length === 1) {
                    processTasks();
                }
                if (obj.data.common.type === 'number') {
                    adapter.setState(id, parseFloat(data[attr]), true);
                } else if (obj.data.common.type === 'boolean') {
                    adapter.setState(id, (data[attr] || '').toUpperCase() === 'ON', true);
                } else {
                    adapter.setState(id, data[attr], true);
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

        // Update alive state
        let idAlive = adapter.namespace + '.' + client.id + '.alive';

        adapter.getForeignState(idAlive, function (err, state) {
            if (!state || !state.val) {
                adapter.setForeignState(idAlive, true, true);
            }
        });

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

        // ignore: stat/SonoffPOW/RESULT = {"POWER":"ON"}
        if (stateId === 'RESULT' || stateId === 'LWT') return;

        // tele/sonoff_4ch/STATE = {"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}
        // tele/sonoff/SENSOR    = {"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}
        // tele/sonoff5/SENSOR   = {"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}
        // tele/sonoff/SENSOR    = {"Time":"2018-02-23T17:36:59", "Analog0":298}
        if (parts[0] === 'tele' && stateId.match(/^(STATE|SENSOR)\d?$/)) {
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

                tasks.push(obj);

                if (tasks.length === 1) {
                    processTasks();
                }

                if (parts[0] === 'cmnd') {
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
                let granted = [];
                // just confirm the request.
                // we expect subscribe for 'cmnd.sonoff.#'
                for (let i = 0; i < packet.subscriptions.length; i++) {
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

        // Update connection state
        updateClients();

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
