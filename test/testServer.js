'use strict';
let expect = require('chai').expect;
let setup  = require(__dirname + '/lib/setup');

let objects = null;
let states  = null;
let mqttClientEmitter = null;
let mqttClientDetector = null;
let connected = false;
let lastReceivedTopic1;
let lastReceivedMessage1;
let lastReceivedTopic2;
let lastReceivedMessage2;

let clientConnected1 = false;
let clientConnected2 = false;
let brokerStarted    = false;

let rules = {
    'tele/sonoff_4ch/STATE':           {send: '{"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}',  expect: {Vcc: 3.226, Wifi_RSSI: 15}},
    'tele/sonoff/SENSOR':              {send: '{"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}',  expect: {DS18x20_DS1_Temperature: 12.2}},
    'tele/sonoff5/SENSOR':             {send: '{"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}',  expect: {'AM2301_14_Temperature': 21.6, 'AM2301_14_Humidity': 54.7}},
    'tele/SonoffPOW/INFO1':            {send: '{"Module":"Sonoff Pow", "Version":"5.8.0", "FallbackTopic":"SonoffPOW", "GroupTopic":"sonoffs"}',  expect: {'INFO.Module': 'Sonoff Pow', 'INFO.Version': '5.8.0'}},
    'tele/SonoffPOW/INFO2':            {send: '{"WebServerMode":"Admin", "Hostname":"Sonoffpow", "IPAddress":"192.168.2.182"}',  expect: {'INFO.Hostname': 'Sonoffpow', 'INFO.IPAddress': '192.168.2.182'}},
    'tele/SonoffPOW/INFO3':            {send: '{"RestartReason":"Software/System restart"}',  expect: {'INFO.RestartReason': 'Software/System restart'}},
    'tele/sonoff_4ch/ENERGY':          {send: '{"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {'ENERGY.Total': 1.753, 'ENERGY.Current': 0.097}},
    'tele/sonoff_4ch/ENERGY1':         {send: '"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {}},

    '/ESP_BOX/BM280/Pressure':         {send: '1010.09',    expect: {'Pressure': 1010.09}},
    '/ESP_BOX/BM280/Humidity':         {send: '42.39',      expect: {'Humidity': 42.39}},
    '/ESP_BOX/BM280/Temperature':      {send: '25.86',      expect: {'Temperature': 25.86}},
    '/ESP_BOX/BM280/Approx. Altitude': {send: '24',         expect: {'Approx_Altitude': 24}},
    'stat/sonoff/POWER':               {send: 'ON',         expect: {'POWER': true}},
    'cmnd/sonoff/POWER':               {send: '',           expect: {}},
    'stat/sonoff/RESULT':              {send: '{"POWER": "ON"}', expect: {'RESULT': null}},
    'stat/sonoff/LWT':                 {send: 'someTopic',  expect: {'LWT': null}},
    'stat/sonoff/ABC':                 {send: 'text',       expect: {'ABC': null}}
};

function startClients(_done) {
    // start mqtt client
    const MqttClient = require(__dirname + '/lib/mqttClient.js');

    // Start client to emit topics
    mqttClientEmitter = new MqttClient(function () {
        // on connected
        console.log('Test MQTT Emitter is connected to MQTT broker');
        clientConnected1 = true;
        if (_done && brokerStarted && clientConnected1 && clientConnected2) {
            _done();
            _done = null;
        }
    }, function (topic, message) {
        console.log((new Date()).getTime() + ' emitter received ' + topic + ': ' + message.toString());
        // on receive
        lastReceivedTopic1   = topic;
        lastReceivedMessage1 = message ? message.toString() : null;
    }, {name: 'Emitter', user: 'user', pass: 'pass1'});

    // Start client to receive topics
    mqttClientDetector = new MqttClient(function () {
        // on connected
        console.log('Test MQTT Detector is connected to MQTT broker');
        clientConnected2 = true;
        if (_done && brokerStarted && clientConnected1 && clientConnected2) {
            _done();
            _done = null;
        }
    }, function (topic, message) {
        console.log((new Date()).getTime() + ' detector received ' + topic + ': ' + message.toString());
        // on receive
        lastReceivedTopic2   = topic;
        lastReceivedMessage2 = message ? message.toString() : null;
        console.log(JSON.stringify(lastReceivedMessage2));
    }, {name: 'Detector', user: 'user', pass: 'pass1'});
}

function checkMqtt2Adapter(id, task, _it, _done) {
    _it.timeout(1000);

    lastReceivedMessage1 = null;
    lastReceivedTopic1   = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    mqttClientEmitter.publish(id, task.send, function (err) {
        expect(err).to.be.undefined;

        setTimeout(function () {
            let count = 0;
            for (let e in task.expect) {
                if (! task.expect.hasOwnProperty(e)) continue;
                count++;
                (function (_id, _val) {
                    objects.getObject('sonoff.0.Emitter.' + _id, function (err, obj) {
                        if (_val !== null) {
                            expect(obj).to.be.not.null.and.not.undefined;
                            expect(obj._id).to.be.equal('sonoff.0.Emitter.' + _id);
                            expect(obj.type).to.be.equal('state');

                            states.getState(obj._id, function (err, state) {
                                expect(state).to.be.not.null.and.not.undefined;
                                expect(state.val).to.be.equal(_val);
                                expect(state.ack).to.be.true;
                                if (!--count) _done();
                            });
                        } else {
                            expect(obj).to.be.undefined;

                            states.getState('sonoff.0.Emitter.' + _id, function (err, state) {
                                expect(state).to.be.undefined;
                                if (!--count) _done();
                            });
                        }
                    });
                })(e, task.expect[e]);
            }
            if (!count) _done();
        }, 100);
    });
}

function checkAdapter2Mqtt(id, mqttid, value, _done) {
    console.log(new Date().getTime() + ' Send ' + id + ' with value '+ value);

    lastReceivedTopic1   = null;
    lastReceivedMessage1 = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    states.setState(id, {
        val: value,
        ack: false
    }, function (err, id) {
        setTimeout(function () {
            if (!lastReceivedTopic1) {
                setTimeout(function () {
                    expect(lastReceivedTopic1).to.be.equal(mqttid);
                    expect(lastReceivedMessage1).to.be.equal(value ? 'ON' : 'OFF');
                    _done();
                }, 200);
            } else {
                expect(lastReceivedTopic1).to.be.equal(mqttid);
                expect(lastReceivedMessage1).to.be.equal(value ? 'ON' : 'OFF');
                _done();
            }
        }, 200);
    });
}

function checkConnection(value, done, counter) {
    counter = counter || 0;
    if (counter > 20) {
        done && done('Cannot check ' + value);
        return;
    }

    states.getState('sonoff.0.info.connection', function (err, state) {
        if (err) console.error(err);
        if (state && typeof state.val === 'string' && ((value && state.val.indexOf(',') !== -1) || (!value && state.val.indexOf(',') === -1))) {
            connected = value;
            done();
        } else {
            setTimeout(function () {
                checkConnection(value, done, counter + 1);
            }, 1000);
        }
    });
}

describe('Sonoff server: Test mqtt server', function() {
    before('Sonoff server: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm
        setup.adapterStarted = false;

        setup.setupController(function () {
            let config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.user     = 'user';
            config.native.pass     = '*\u0006\u0015\u0001\u0004';
            setup.setAdapterConfig(config.common, config.native);

            setup.startController(function (_objects, _states) {
                objects = _objects;
                states  = _states;
                brokerStarted = true;
                if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                    _done();
                    _done = null;
                }
            });
        });

        startClients(_done);
    });

    it('Sonoff Server: Check if connected to MQTT broker', function (done) {
        this.timeout(2000);
        if (!connected) {
            checkConnection(true, done);
        } else {
            done();
        }
    });

    for (let r in rules) {
        (function(id, task) {
            it('Sonoff Server: Check receive ' + id, function (done) {
                checkMqtt2Adapter(id, task, this, done);
            });
        })(r, rules[r]);
    }

    // give time to client to receive all messages
    it('wait', function (done) {
        this.timeout(3000);
        setTimeout(function () {
            done();
        }, 1000);
    });

    it('Sonoff server: detector must receive cmnd/sonoff/POWER', function (done) {
        this.timeout(2000);
        checkAdapter2Mqtt('sonoff.0.Emitter.POWER', 'cmnd/sonoff/POWER', false, done);
    });

    it('Sonoff Server: check reconnection', function (done) {
        this.timeout(10000);
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        checkConnection(false, function (error) {
            expect(error).to.be.not.ok;
            startClients();
            checkConnection(true, function (error) {
                expect(error).to.be.not.ok;
                done();
            });
        });
    });

    after('Sonoff Server: Stop js-controller', function (done) {
        this.timeout(5000);
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        setup.stopController(function () {
            done();
        });
    });
});
