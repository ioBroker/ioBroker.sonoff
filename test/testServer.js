/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';
const expect = require('chai').expect;
const setup = require('@iobroker/legacy-testing');

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

const rules = {
    'tele/sonoff_4ch/STATE':           {send: '{"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}',  expect: {Vcc: 3.226, Wifi_RSSI: 15, Time: '2017-10-02T19:26:06'}},
    'tele/sonoff/SENSOR':              {send: '{"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}',  expect: {DS18x20_DS1_Temperature: 12.2}},
    'tele/sonoff5/SENSOR':             {send: '{"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}',  expect: {'AM2301-14_Temperature': 21.6, 'AM2301-14_Humidity': 54.7}},
    'tele/SonoffPOW/INFO1':            {send: '{"Module":"Sonoff Pow", "Version":"5.8.0", "FallbackTopic":"SonoffPOW", "GroupTopic":"sonoffs"}',  expect: {'INFO.Module': 'Sonoff Pow', 'INFO.Version': '5.8.0'}},
    'tele/SonoffPOW/INFO2':            {send: '{"WebServerMode":"Admin", "Hostname":"Sonoffpow", "IPAddress":"192.168.2.182"}',  expect: {'INFO.Hostname': 'Sonoffpow', 'INFO.IPAddress': '192.168.2.182'}},
    'tele/SonoffPOW/INFO3':            {send: '{"RestartReason":"Software/System restart"}',  expect: {'INFO.RestartReason': 'Software/System restart'}},
    'tele/sonoff_4ch/ENERGY':          {send: '{"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {'ENERGY.Total': 1.753, 'ENERGY.Current': 0.097, 'ENERGY.Power': 3}},
    'tele/sonoff_4ch/ENERGY1':         {send: '"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {}},
    'tele/sonoff_1ch/STATE':           {send: '{"Time":"2017-10-02T19:24:32", "Color": "112233"}',  expect: {}},
    'tele/sonoff/STATE':               {send: '{"Time":"2018-06-19T06:39:33","Uptime":"0T23:47:32","Vcc":3.482,"POWER":"OFF","Dimmer":100,"Color":"000000FF","HSBColor":"0,0,0","Channel":[0,0,0,100],"Scheme":0,"Fade":"OFF","Speed":4,"LedTable":"OFF","Wifi":{"AP":1,"SSId":"WLAN-7490","RSSI":50,"APMac":"34:31:C4:C6:EB:0F"}}',
        expect:{}},
    'tele/sonoff1/SENSOR':             {send: '{"Time":"2018-06-15T10:03:24","DS18B20":{"Temperature":0.0},"TempUnit":"C"}', expect: {'DS18B20_Temperature': 0}},
    'tele/nan/SENSOR':                 {send: '{"Time":"2018-10-31T11:57:31","SI7021-00":{"Temperature":17.1,"Humidity":70.0},"SI7021-02":{"Temperature":nan,"Humidity":nan},"SI7021-04":{"Temperature":10.0,"Humidity":59.7},"SI7021-05":{"Temperature":8.8,"Humidity":79.3},"TempUnit":"C"}', expect: {'SI7021-04_Temperature': 10}},
    'tele/true/SENSOR':                {send: '{"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"true"}', expect: {POWER1: true}},
    '/ESP_BOX/BM280/Pressure':         {send: '1010.09',    expect: {'Pressure': 1010.09}},
    '/ESP_BOX/BM280/Humidity':         {send: '42.39',      expect: {'Humidity': 42.39}},
    '/ESP_BOX/BM280/Temperature':      {send: '25.86',      expect: {'Temperature': 25.86}},
    '/ESP_BOX/BM280/Approx. Altitude': {send: '24',         expect: {'Approx_Altitude': 24}},
    'stat/sonoff/POWER':               {send: 'ON',         expect: {'POWER': true}},
    'cmnd/sonoff/POWER':               {send: '',           expect: {}},
    'stat/sonoff/RESULT':              {send: '{"POWER": "ON"}', expect: {'RESULT': null}},
    'stat/sonoff/LWT':                 {send: 'someTopic',  expect: {'LWT': null}},
    'stat/sonoff/ABC':                 {send: 'text',       expect: {'ABC': null}},
    // This command overwrites the adresses of the devices
    'tele/tasmota_0912A7/STATE':       {send: '{"Time":"2021-05-02T18:08:19","Uptime":"0T03:15:43","UptimeSec":11743,"Heap":26,"SleepMode":"Dynamic","Sleep":50,"LoadAvg":19,"MqttCount":11,"POWER":"ON","Wifi":{"AP":1,"SSId":"Skynet","BSSId":"3C:A6:2F:23:6A:94","Channel":6,"RSSI":52,"Signal":-74,"LinkCount":1,"Downtime":"0T00:00:07"}}', expect: {'Wifi_Downtime': '0T00:00:07'}},
    'tele/Hof/Lager/Tasmota/Relais/RFresv/Beleuchtung/UV/Beleuchtungsstaerke/Außenlampe/SENSOR':
        {
            send: '{"Time":"2021-05-28T14:30:44","BH1750":{"Illuminance":27550},"VEML6075":{"UvaIntensity":1710,"UvbIntensity":890,"UvIndex":2.4}}',
            expect: {'VEML6075_UvIndex': 2.4}
        },
    'tele/esp32_shutter/STATE':           {send: '{"Time":"2025-01-07T10:00:00","Uptime":"0T01:00:00","SHUTTER1":0,"SHUTTER2":25,"SHUTTER3":50,"SHUTTER4":75,"SHUTTER5":100,"SHUTTER6":0,"SHUTTER7":25,"SHUTTER8":50,"SHUTTER9":75,"SHUTTER10":100,"SHUTTER11":0,"SHUTTER12":25,"SHUTTER13":50,"SHUTTER14":75,"SHUTTER15":100,"SHUTTER16":33}', expect: {SHUTTER1: 0, SHUTTER2: 25, SHUTTER3: 50, SHUTTER4: 75, SHUTTER5: 100, SHUTTER6: 0, SHUTTER7: 25, SHUTTER8: 50, SHUTTER9: 75, SHUTTER10: 100, SHUTTER11: 0, SHUTTER12: 25, SHUTTER13: 50, SHUTTER14: 75, SHUTTER15: 100, SHUTTER16: 33}},
    'tele/IO-Board2_T/SENSOR':            {send: '{"Time":"2025-09-06T19:16:49","Switch1":"OFF","Switch2":"OFF","Switch3":"OFF","Switch4":"OFF","Switch5":"OFF","Switch7":"ON","Switch8":"OFF","Switch9":"OFF","ESP32":{"Temperature":33.9},"TempUnit":"C"}', expect: {Switch1: false, Switch2: false, Switch3: false, Switch4: false, Switch5: false, Switch7: true, Switch8: false, Switch9: false, ESP32_Temperature: 33.9}},
    // Comprehensive Switch1-28 test with all switches
    'tele/esp32_switch_board/SENSOR':     {send: '{"Time":"2025-09-06T20:00:00","Switch1":"ON","Switch2":"OFF","Switch3":"ON","Switch4":"OFF","Switch5":"ON","Switch6":"OFF","Switch7":"ON","Switch8":"OFF","Switch9":"ON","Switch10":"OFF","Switch11":"ON","Switch12":"OFF","Switch13":"ON","Switch14":"OFF","Switch15":"ON","Switch16":"OFF","Switch17":"ON","Switch18":"OFF","Switch19":"ON","Switch20":"OFF","Switch21":"ON","Switch22":"OFF","Switch23":"ON","Switch24":"OFF","Switch25":"ON","Switch26":"OFF","Switch27":"ON","Switch28":"OFF"}', expect: {Switch1: true, Switch2: false, Switch3: true, Switch4: false, Switch5: true, Switch6: false, Switch7: true, Switch8: false, Switch9: true, Switch10: false, Switch11: true, Switch12: false, Switch13: true, Switch14: false, Switch15: true, Switch16: false, Switch17: true, Switch18: false, Switch19: true, Switch20: false, Switch21: true, Switch22: false, Switch23: true, Switch24: false, Switch25: true, Switch26: false, Switch27: true, Switch28: false}},
    // Test Switch1-10 range with mixed states
    'tele/tasmota_switch_10/SENSOR':      {send: '{"Time":"2025-09-06T20:01:00","Switch1":"OFF","Switch2":"ON","Switch3":"OFF","Switch4":"ON","Switch5":"OFF","Switch6":"ON","Switch7":"OFF","Switch8":"ON","Switch9":"OFF","Switch10":"ON"}', expect: {Switch1: false, Switch2: true, Switch3: false, Switch4: true, Switch5: false, Switch6: true, Switch7: false, Switch8: true, Switch9: false, Switch10: true}},
    // Test Switch11-20 range
    'tele/tasmota_switch_20/SENSOR':      {send: '{"Time":"2025-09-06T20:02:00","Switch11":"ON","Switch12":"ON","Switch13":"OFF","Switch14":"OFF","Switch15":"ON","Switch16":"ON","Switch17":"OFF","Switch18":"OFF","Switch19":"ON","Switch20":"ON"}', expect: {Switch11: true, Switch12: true, Switch13: false, Switch14: false, Switch15: true, Switch16: true, Switch17: false, Switch18: false, Switch19: true, Switch20: true}},
    // Test Switch21-28 range
    'tele/tasmota_switch_28/SENSOR':      {send: '{"Time":"2025-09-06T20:03:00","Switch21":"OFF","Switch22":"OFF","Switch23":"OFF","Switch24":"OFF","Switch25":"ON","Switch26":"ON","Switch27":"ON","Switch28":"ON"}', expect: {Switch21: false, Switch22: false, Switch23: false, Switch24: false, Switch25: true, Switch26: true, Switch27: true, Switch28: true}},
};

function encryptLegacy(key, value) {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startClients(_done) {
    // start mqtt client
    const MqttClient = require('./lib/mqttClient.js');

    // Start a client to emit topics
    mqttClientEmitter = new MqttClient(connected => {
        // on connected
        if (connected) {
            console.log('Test MQTT Emitter is connected to MQTT broker');
            clientConnected1 = true;
            if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                _done();
                _done = null;
            }
        }
    }, (topic, message) => {
        console.log(`${Date.now()} emitter received ${topic}: ${message.toString()}`);
        // on receive
        lastReceivedTopic1   = topic;
        lastReceivedMessage1 = message ? message.toString() : null;
    }, {name: 'Emitter*1', user: 'user', pass: 'pass1'});

    // Start another client to receive topics
    mqttClientDetector = new MqttClient(connected => {
        // on connected
        if (connected) {
            console.log('Test MQTT Detector is connected to MQTT broker');
            clientConnected2 = true;
            if (_done && brokerStarted && clientConnected1 && clientConnected2) {
                _done();
                _done = null;
            }
        }
    }, (topic, message) => {
        console.log(`${Date.now()} detector received ${topic}: ${message.toString()}`);
        // on receive
        lastReceivedTopic2   = topic;
        lastReceivedMessage2 = message ? message.toString() : null;
        console.log(JSON.stringify(lastReceivedMessage2));
    }, {name: 'Detector-1', user: 'user', pass: 'pass1'});
}

function checkMqtt2Adapter(id, task, _it, _done) {
    _it.timeout(1000);

    lastReceivedMessage1 = null;
    lastReceivedTopic1   = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    console.log(`[${new Date().toISOString()}] Publish ${id}: ${task.send}`);
    mqttClientEmitter.publish(id, task.send, err => {
        expect(err).to.be.undefined;

        setTimeout(() => {
            let count = 0;
            for (let e in task.expect) {
                if (! task.expect.hasOwnProperty(e)) {
                    continue;
                }
                count++;
                (function (_id, _val) {
                    objects.getObject(`sonoff.0.Emitter_1.${_id}`, (err, obj) => {
                        if (_val !== null) {
                            !obj && console.error(`Object sonoff.0.Emitter_1.${_id} not found`);
                            expect(obj).to.be.not.null.and.not.undefined;
                            expect(obj._id).to.be.equal(`sonoff.0.Emitter_1.${_id}`);
                            expect(obj.type).to.be.equal('state');

                            states.getState(obj._id, function (err, state) {
                                expect(state).to.be.not.null.and.not.undefined;
                                expect(state.val).to.be.equal(_val);
                                expect(state.ack).to.be.true;
                                if (!--count) _done();
                            });
                        } else {
                            expect(obj).to.be.null;

                            states.getState(`sonoff.0.Emitter_1.${_id}`, (err, state) => {
                                expect(state).to.be.null;
                                if (!--count) _done();
                            });
                        }
                    });
                })(e, task.expect[e]);
            }
            if (!count) _done();
        }, 200);
    });
}

function checkAdapter2Mqtt(id, mqttid, value, _done) {
    console.log(`${new Date().toISOString()} Send ${id} with value ${value}`);

    lastReceivedTopic1   = null;
    lastReceivedMessage1 = null;
    lastReceivedTopic2   = null;
    lastReceivedMessage2 = null;

    states.setState(id, {
        val: value,
        ack: false
    }, (err, id) => {
        setTimeout(() => {
            if (!lastReceivedTopic1) {
                setTimeout(() => {
                    expect(lastReceivedTopic1).to.be.equal(mqttid);
                    expect(lastReceivedMessage1).to.be.equal(value ? 'ON' : 'OFF');
                    _done();
                }, 200);
            } else {
                expect(lastReceivedTopic1).to.be.equal(mqttid);
                expect(lastReceivedMessage1).to.be.equal(value ? 'ON' : 'OFF');
                _done();
            }
        }, 1000);
    });
}

function checkConnection(value, done, counter) {
    counter = counter || 0;
    if (counter > 20) {
        done && done(`Cannot check ${value}`);
        return;
    }

    states.getState('sonoff.0.info.connection', (err, state) => {
        if (err) console.error(err);
        if (state && typeof state.val === 'string' && ((value && state.val.indexOf(',') !== -1) || (!value && state.val.indexOf(',') === -1))) {
            connected = value;
            done();
        } else {
            setTimeout(() => {
                checkConnection(value, done, counter + 1);
            }, 1000);
        }
    });
}

describe('Sonoff server: Test mqtt server', () => {
    before('Sonoff server: Start js-controller', function (_done) { //
        this.timeout(600000); // because of the first installation from npm
        setup.adapterStarted = false;

        setup.setupController(async () => {
            let systemConfig = await setup.getObject('system.config');
            if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
                systemConfig = systemConfig || {common: {}, native: { secret: '12345' }};
                systemConfig.native = systemConfig.native || { secret: '12345' };
                systemConfig.native.secret = systemConfig.native.secret || '12345';
                await setup.setObject('system.config', systemConfig);
            }
            let config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.user     = 'user';
            config.native.password = encryptLegacy(systemConfig.native.secret, 'pass1');

            await setup.setAdapterConfig(config.common, config.native);

            setup.startController((_objects, _states) => {
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

    it('Sonoff Server: Check if connected to MQTT broker', done => {
        if (!connected) {
            checkConnection(true, done);
        } else {
            done();
        }
    }).timeout(2000);

    for (let r in rules) {
        (function(id, task) {
            it(`Sonoff Server: Check receive ${id}`, function (done) { // let FUNCTION here
                checkMqtt2Adapter(id, task, this, done);
            });
        })(r, rules[r]);
    }

    // give time to a client to receive all messages
    it('wait', done => {
        setTimeout(() => done(), 1000);
    }).timeout(4000);

    it('Sonoff server: detector must receive cmnd/tasmota_0912A7/POWER', done => {
        checkAdapter2Mqtt('sonoff.0.Emitter_1.POWER', 'cmnd/tasmota_0912A7/POWER', false, done);
    }).timeout(4000);

    it('Sonoff Server: Check ENERGY.Power object role', done => {
        objects.getObject('sonoff.0.Emitter_1.ENERGY.Power', (err, obj) => {
            expect(err).to.be.null;
            expect(obj).to.be.not.null.and.not.undefined;
            expect(obj.common.role).to.be.equal('value.power');  // Should be value.power not value.power.consumption
            done();
        });
    }).timeout(2000);

    it('Sonoff Server: check reconnection', done => {
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        checkConnection(false, error => {
            expect(error).to.be.not.ok;
            startClients();
            checkConnection(true, error => {
                expect(error).to.be.not.ok;
                done();
            });
        });
    }).timeout(1000000);

    after('Sonoff Server: Stop js-controller', function (_done) { // let FUNCTION and not => here
        this.timeout(5000);
        mqttClientEmitter.stop();
        mqttClientDetector.stop();
        setup.stopController(() => _done());
    });
});
