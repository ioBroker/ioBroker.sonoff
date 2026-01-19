/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');
const { expect } = require('chai');

// Test MQTT client
const MqttClient = require('./lib/mqttClient.js');

// Test data - MQTT messages to send and expected state values
const rules = {
    'tele/sonoff_4ch/STATE':           {send: '{"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"OFF", "POWER2":"OFF", "POWER3":"OFF", "POWER4":"OFF", "Wifi":{"AP":1, "SSId":"AAA", "RSSI": 15}}',  expect: {Vcc: 3.226, Wifi_RSSI: 15, Time: '2017-10-02T19:26:06'}},
    'tele/sonoff/SENSOR':              {send: '{"Time":"2017-10-05T17:43:19", "DS18x20":{"DS1":{"Type":"DS18B20", "Address":"28FF9A9876815022A", "Temperature":12.2}}, "TempUnit":"C"}',  expect: {DS18x20_DS1_Temperature: 12.2}},
    'tele/sonoff5/SENSOR':             {send: '{"Time":"2017-10-03T14:02:25", "AM2301-14":{"Temperature":21.6, "Humidity":54.7}, "TempUnit":"C"}',  expect: {'AM2301-14_Temperature': 21.6, 'AM2301-14_Humidity': 54.7}},
    'tele/SonoffPOW/INFO1':            {send: '{"Module":"Sonoff Pow", "Version":"5.8.0", "FallbackTopic":"SonoffPOW", "GroupTopic":"sonoffs"}',  expect: {'INFO.Module': 'Sonoff Pow', 'INFO.Version': '5.8.0'}},
    'tele/SonoffPOW/INFO2':            {send: '{"WebServerMode":"Admin", "Hostname":"Sonoffpow", "IPAddress":"192.168.2.182"}',  expect: {'INFO.Hostname': 'Sonoffpow', 'INFO.IPAddress': '192.168.2.182'}},
    'tele/SonoffPOW/INFO3':            {send: '{"RestartReason":"Software/System restart"}',  expect: {'INFO.RestartReason': 'Software/System restart'}},
    'tele/sonoff_4ch/ENERGY':          {send: '{"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {'ENERGY.Total': 1.753, 'ENERGY.Current': 0.097, 'ENERGY.Power': 3}},
    'tele/sonoffPOW/MARGINS':          {send: '{"Time":"2020-04-23T10:15:00","PowerLow":100,"PowerHigh":2000,"PowerDelta":50}',  expect: {'MARGINS.PowerLow': 100, 'MARGINS.PowerHigh': 2000, 'MARGINS.PowerDelta': 50}},
    'tele/powR2/ENERGY':               {send: '{"Time":"2022-09-06T11:17:35", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":5, "Power":42, "ApparentPower":44, "ReactivePower":12, "Factor":0.95, "Voltage":230, "Current":0.183}',  expect: {'ENERGY.Total': 1.753, 'ENERGY.Yesterday': 0.308, 'ENERGY.Today': 0.205, 'ENERGY.Period': 5, 'ENERGY.Power': 42, 'ENERGY.ApparentPower': 44, 'ENERGY.ReactivePower': 12, 'ENERGY.Factor': 0.95, 'ENERGY.Voltage': 230, 'ENERGY.Current': 0.183}},
    'tele/powR2/STATE':                {send: '{"Time":"2022-09-06T11:17:35", "Uptime":"0T02:23:45", "UptimeSec":8625, "POWER":"ON", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Power":42, "Factor":0.95, "Voltage":230, "Current":0.183, "Wifi":{"AP":1, "SSId":"MyWiFi", "RSSI":58}}',  expect: {'Total': 1.753, 'Yesterday': 0.308, 'Today': 0.205, 'Power': 42, 'Factor': 0.95, 'Voltage': 230, 'Current': 0.183, 'POWER': true}},
    'tele/sonoff_4ch/ENERGY1':         {send: '"Time":"2017-10-02T19:24:32", "Total":1.753, "Yesterday":0.308, "Today":0.205, "Period":0, "Power":3, "Factor":0.12, "Voltage":221, "Current":0.097}',  expect: {}},
    'tele/sonoff_1ch/STATE':           {send: '{"Time":"2017-10-02T19:24:32", "Color": "112233"}',  expect: {}},
    'tele/sonoff/STATE':               {send: '{"Time":"2018-06-19T06:39:33","Uptime":"0T23:47:32","Vcc":3.482,"POWER":"OFF","Dimmer":100,"Color":"000000FF","HSBColor":"0,0,0","Channel":[0,0,0,100],"Scheme":0,"Fade":"OFF","Speed":4,"LedTable":"OFF","Wifi":{"AP":1,"SSId":"WLAN-7490","RSSI":50,"APMac":"34:31:C4:C6:EB:0F"}}',
        expect:{}},
    'tele/sonoff1/SENSOR':             {send: '{"Time":"2018-06-15T10:03:24","DS18B20":{"Temperature":0.0},"TempUnit":"C"}', expect: {'DS18B20_Temperature': 0}},
    'tele/nan/SENSOR':                 {send: '{"Time":"2018-10-31T11:57:31","SI7021-00":{"Temperature":17.1,"Humidity":70.0},"SI7021-02":{"Temperature":nan,"Humidity":nan},"SI7021-04":{"Temperature":10.0,"Humidity":59.7},"SI7021-05":{"Temperature":8.8,"Humidity":79.3},"TempUnit":"C"}', expect: {'SI7021-04_Temperature': 10}},
    'tele/true/SENSOR':                {send: '{"Time":"2017-10-02T19:26:06", "Uptime":0, "Vcc":3.226, "POWER1":"true"}', expect: {POWER1: true}},
    '/ESP_BOX/BM280/Pressure':         {send: '1010.09',    expect: {'Pressure': 1010.09}},
    'tele/tasmota_BMP280/SENSOR':      {send: '{"Time":"2024-02-25T11:27:00","BMP280":{"Temperature":28.520,"Pressure":753.3},"PressureUnit":"mmHg"}', expect: {'BMP280_Temperature': 28.520, 'BMP280_Pressure': 753.3}},
    'tele/tasmota_BME280/SENSOR':      {send: '{"Time":"2024-02-25T11:27:00","BME280":{"Temperature":25.1,"Pressure":1013.2,"Humidity":65.5},"TempUnit":"F","PressureUnit":"mmHg"}', expect: {'BME280_Temperature': 25.1, 'BME280_Pressure': 1013.2, 'BME280_Humidity': 65.5}},
    '/ESP_BOX/BM280/Humidity':         {send: '42.39',      expect: {'Humidity': 42.39}},
    '/ESP_BOX/BM280/Temperature':      {send: '25.86',      expect: {'Temperature': 25.86}},
    '/ESP_BOX/BM280/Approx. Altitude': {send: '24',         expect: {'Approx_Altitude': 24}},
    'stat/sonoff/POWER':               {send: 'ON',         expect: {'POWER': true}},
    'cmnd/sonoff/POWER':               {send: '',           expect: {}},
    'stat/sonoff/RESULT':              {send: '{"POWER": "ON"}', expect: {'RESULT': null}},
    'stat/sonoff/LWT':                 {send: 'someTopic',  expect: {'LWT': null}},
    'stat/sonoff/ABC':                 {send: 'text',       expect: {'ABC': null}},
    // This command overwrites the adresses of the devices
    'tele/Hof/Lager/Tasmota/Relais/RFresv/Beleuchtung/UV/Beleuchtungsstaerke/Außenlampe/SENSOR':
        {
            send: '{"Time":"2021-05-28T14:30:44","BH1750":{"Illuminance":27550},"VEML6075":{"UvaIntensity":1710,"UvbIntensity":890,"UvIndex":2.4}}',
            expect: {'VEML6075_UvIndex': 2.4}
        },
    // Sonoff B1 (RGB LED controller) test cases based on actual device logs
    'tele/LED1/STATE':                    {send: '{"Time":"2018-01-19T19:45:22","Uptime":0,"Vcc":3.289,"POWER":"ON","Wifi":{"AP":1,"SSId":"SmartHOME","RSSI":96,"APMac":"60:31:97:3E:74:B4"}}', expect: {Vcc: 3.289, POWER: true, Wifi_RSSI: 96}},
    'tele/LED1/INFO1':                    {send: '{"Module":"Sonoff B1","Version":"5.9.1f","FallbackTopic":"LED1","GroupTopic":"sonoffs"}', expect: {'INFO.Module': 'Sonoff B1', 'INFO.Version': '5.9.1f'}},
    'stat/LED1/RESULT1':                  {send: '{"POWER":"ON","Dimmer":100,"Color":"FFFFFF0000"}', expect: {'RESULT': null}},
    'stat/LED1/RESULT2':                  {send: '{"Dimmer":100}', expect: {'RESULT': null}},
    'stat/LED1/RESULT3':                  {send: '{"CT":499}', expect: {'RESULT': null}},
    // Sonoff SC (Environmental Sensor) test cases based on actual device logs
    'tele/HomeMonitor/INFO1':             {send: '{"Module":"Sonoff SC","Version":"5.9.1f","FallbackTopic":"HomeMonitor","GroupTopic":"sonoffs"}', expect: {'INFO.Module': 'Sonoff SC', 'INFO.Version': '5.9.1f'}},
    'tele/HomeMonitor/STATE':             {send: '{"Time":"2018-01-19T20:15:16","Uptime":0,"Vcc":3.170,"Wifi":{"AP":1,"SSId":"SmartHOME","RSSI":100,"APMac":"60:31:97:3E:74:B4"}}', expect: {Vcc: 3.170, Wifi_RSSI: 100}},
    'tele/HomeMonitor/SENSOR':            {send: '{"Time":"2018-01-19T20:15:16","Temperature":20.0,"Humidity":16.0,"Light":10,"Noise":60,"AirQuality":90,"TempUnit":"C"}', expect: {Temperature: 20.0, Humidity: 16.0, Light: 10, Noise: 60, AirQuality: 90}},
    'tele/esp32_shutter/STATE':           {send: '{"Time":"2025-01-07T10:00:00","Uptime":"0T01:00:00","SHUTTER1":0,"SHUTTER2":25,"SHUTTER3":50,"SHUTTER4":75,"SHUTTER5":100,"SHUTTER6":0,"SHUTTER7":25,"SHUTTER8":50,"SHUTTER9":75,"SHUTTER10":100,"SHUTTER11":0,"SHUTTER12":25,"SHUTTER13":50,"SHUTTER14":75,"SHUTTER15":100,"SHUTTER16":33}', expect: {SHUTTER1: 0, SHUTTER2: 25, SHUTTER3: 50, SHUTTER4: 75, SHUTTER5: 100, SHUTTER6: 0, SHUTTER7: 25, SHUTTER8: 50, SHUTTER9: 75, SHUTTER10: 100, SHUTTER11: 0, SHUTTER12: 25, SHUTTER13: 50, SHUTTER14: 75, SHUTTER15: 100, SHUTTER16: 33}},
    // Shutter control test cases - issue #278
    'stat/TM_Shutter/RESULT':             {send: '{"Shutter1":{"Position":56,"Direction":0,"Target":56,"Tilt":0}}', expect: {'Shutter1_Position': 56, 'Shutter1_Direction': 0, 'Shutter1_Target': 56, 'Shutter1_Tilt': 0}},
    'stat/Shutter_Device/RESULT':         {send: '{"Shutter2":{"Position":75,"Direction":1,"Target":100,"Tilt":25}}', expect: {'Shutter2_Position': 75, 'Shutter2_Direction': 1, 'Shutter2_Target': 100, 'Shutter2_Tilt': 25}},
    'stat/MultiShutter/RESULT':           {send: '{"Shutter3":{"Position":0,"Direction":-1,"Target":0,"Tilt":50},"Shutter4":{"Position":100,"Direction":0,"Target":100,"Tilt":0}}', expect: {'Shutter3_Position': 0, 'Shutter3_Direction': -1, 'Shutter3_Target': 0, 'Shutter3_Tilt': 50, 'Shutter4_Position': 100, 'Shutter4_Direction': 0, 'Shutter4_Target': 100, 'Shutter4_Tilt': 0}},
    'tele/tasmota/RESULT':                {send: '{"IrReceived":{"Protocol":"FUJITSU_AC","Bits":128,"Data":"0x1463001010FE0930210000000000208F","Repeat":0,"IRHVAC":{"Vendor":"FUJITSU_AC","Model":1,"Mode":"Auto","Power":"On","Celsius":"On","Temp":18,"FanSpeed":"Auto","SwingV":"Off","SwingH":"Off","Quiet":"Off","Turbo":"Off","Econo":"Off","Light":"Off","Filter":"Off","Clean":"Off","Beep":"Off","Sleep":-1}}}', expect: {'IrReceived_IRHVAC_Power': 'On', 'IrReceived_IRHVAC_Light': 'Off', 'IrReceived_IRHVAC_Mode': 'Auto', 'IrReceived_IRHVAC_Vendor': 'FUJITSU_AC', 'IrReceived_IRHVAC_Temp': 18}},
    // Zigbee bulb test case from issue #265
    'tele/Zigbee_Coordinator_CC2530/SENSOR': {send: '{"Time":"2022-05-05T20:49:08","ZbReceived":{"0x0856":{"Device":"0x0856","Name":"E14 Bulb","Power":1,"Dimmer":20,"Endpoint":1,"LinkQuality":65}}}', expect: {'ZbReceived_0x0856_Power': 1, 'ZbReceived_0x0856_Dimmer': 20, 'ZbReceived_0x0856_Device': '0x0856', 'ZbReceived_0x0856_Name': 'E14 Bulb'}},
    // This rule must be last to ensure Emitter_1 maps to tasmota_0912A7 for the existing test
    'tele/tasmota_0912A7/STATE':       {send: '{"Time":"2021-05-02T18:08:19","Uptime":"0T03:15:43","UptimeSec":11743,"Heap":26,"SleepMode":"Dynamic","Sleep":50,"LoadAvg":19,"MqttCount":11,"POWER":"ON","Wifi":{"AP":1,"SSId":"Skynet","BSSId":"3C:A6:2F:23:6A:94","Channel":6,"RSSI":52,"Signal":-74,"LinkCount":1,"Downtime":"0T00:00:07"}}', expect: {'Wifi_Downtime': '0T00:00:07'}},
    'tele/button_test/SENSOR':           {send: '{"Time":"2025-01-07T10:00:00","Button1":{"Action":"SINGLE"}}', expect: {'Button1_Action': 'SINGLE'}},
    'tele/klingel/RESULT':               {send: '{"Button1":{"Action":"SINGLE"}}', expect: {'Button1_Action': 'SINGLE'}},
    'stat/button_device/RESULT':         {send: '{"Button2":{"Action":"DOUBLE"}}', expect: {'Button2_Action': 'DOUBLE'}},
    'tele/IO-Board2_T/SENSOR':            {send: '{"Time":"2025-09-06T19:16:49","Switch1":"OFF","Switch2":"OFF","Switch3":"OFF","Switch4":"OFF","Switch5":"OFF","Switch7":"ON","Switch8":"OFF","Switch9":"OFF","ESP32":{"Temperature":33.9},"TempUnit":"C"}', expect: {Switch1: false, Switch2: false, Switch3: false, Switch4: false, Switch5: false, Switch7: true, Switch8: false, Switch9: false, ESP32_Temperature: 33.9}},
    // Comprehensive Switch1-28 test with all switches
    'tele/esp32_switch_board/SENSOR':     {send: '{"Time":"2025-09-06T20:00:00","Switch1":"ON","Switch2":"OFF","Switch3":"ON","Switch4":"OFF","Switch5":"ON","Switch6":"OFF","Switch7":"ON","Switch8":"OFF","Switch9":"ON","Switch10":"OFF","Switch11":"ON","Switch12":"OFF","Switch13":"ON","Switch14":"OFF","Switch15":"ON","Switch16":"OFF","Switch17":"ON","Switch18":"OFF","Switch19":"ON","Switch20":"OFF","Switch21":"ON","Switch22":"OFF","Switch23":"ON","Switch24":"OFF","Switch25":"ON","Switch26":"OFF","Switch27":"ON","Switch28":"OFF"}', expect: {Switch1: true, Switch2: false, Switch3: true, Switch4: false, Switch5: true, Switch6: false, Switch7: true, Switch8: false, Switch9: true, Switch10: false, Switch11: true, Switch12: false, Switch13: true, Switch14: false, Switch15: true, Switch16: false, Switch17: true, Switch18: false, Switch19: true, Switch20: false, Switch21: true, Switch22: false, Switch23: true, Switch24: false, Switch25: true, Switch26: false, Switch27: true, Switch28: false}},
    // Test Switch1-10 range with mixed states
    'tele/tasmota_switch_10/SENSOR':      {send: '{"Time":"2025-09-06T20:01:00","Switch1":"OFF","Switch2":"ON","Switch3":"OFF","Switch4":"ON","Switch5":"OFF","Switch6":"ON","Switch7":"OFF","Switch8":"ON","Switch9":"OFF","Switch10":"ON"}', expect: {Switch1: false, Switch2: true, Switch3: false, Switch4: true, Switch5: false, Switch6: true, Switch7: false, Switch8: true, Switch9: false, Switch10: true}},
    // Test Switch11-20 range
    'tele/tasmota_switch_20/SENSOR':      {send: '{"Time":"2025-09-06T20:02:00","Switch11":"ON","Switch12":"ON","Switch13":"OFF","Switch14":"OFF","Switch15":"ON","Switch16":"ON","Switch17":"OFF","Switch18":"OFF","Switch19":"ON","Switch20":"ON"}', expect: {Switch11: true, Switch12: true, Switch13: false, Switch14: false, Switch15: true, Switch16: true, Switch17: false, Switch18: false, Switch19: true, Switch20: true}},
    // Test Switch21-28 range
    'tele/tasmota_switch_28/SENSOR':      {send: '{"Time":"2025-09-06T20:03:00","Switch21":"OFF","Switch22":"OFF","Switch23":"OFF","Switch24":"OFF","Switch25":"ON","Switch26":"ON","Switch27":"ON","Switch28":"ON"}', expect: {Switch21: false, Switch22: false, Switch23: false, Switch24: false, Switch25: true, Switch26: true, Switch27: true, Switch28: true}},
    // OpenBeken LED topics - https://github.com/openshwprojects/OpenBK7231T_App/blob/main/docs/mqttTopics.md
    // Testing with /get suffix (reports state)
    'obk_lamp1/led_enableAll/get':        {send: '1', expect: {led_enableAll: true}},
    'obk_lamp1/led_dimmer/get':           {send: '50', expect: {led_dimmer: 50}},
    'obk_lamp2/led_temperature/get':      {send: '500', expect: {led_temperature: 500}},
    'obk_lamp2/led_basecolor_rgb/get':    {send: '00FF00', expect: {led_basecolor_rgb: '00FF00'}},
    // Testing without suffix (alternative mode)
    'obk_lamp3/led_enableAll':            {send: '0', expect: {led_enableAll: false}},
    'obk_lamp3/led_dimmer':               {send: '100', expect: {led_dimmer: 100}},
    'obk_lamp4/led_temperature':          {send: '154', expect: {led_temperature: 154}},
    'obk_lamp4/led_basecolor_rgb':        {send: 'FF0000', expect: {led_basecolor_rgb: 'FF0000'}},
    'obk_lamp5/led_finalcolor_rgbcw/get': {send: 'FFFFFF0000', expect: {led_finalcolor_rgbcw: 'FFFFFF0000'}},
    'obk_lamp5/led_basecolor_rgbcw':      {send: 'FFAABB8899', expect: {led_basecolor_rgbcw: 'FFAABB8899'}},
    'obk_lamp6/led_hue':                  {send: '180', expect: {led_hue: 180}},
    'obk_lamp6/led_saturation':           {send: '75', expect: {led_saturation: 75}},
    // PulseTime test cases - issue #106
    'stat/sonoff_relay/RESULT':           {send: '{"PulseTime1":{"Set":100,"Remaining":95}}', expect: {'PulseTime1_Set': 100, 'PulseTime1_Remaining': 95}},
    'stat/multi_relay/RESULT':            {send: '{"PulseTime1":{"Set":50,"Remaining":0},"PulseTime2":{"Set":200,"Remaining":150}}', expect: {'PulseTime1_Set': 50, 'PulseTime1_Remaining': 0, 'PulseTime2_Set': 200, 'PulseTime2_Remaining': 150}},
    'stat/sonoff4ch/RESULT':              {send: '{"PulseTime3":{"Set":300,"Remaining":250}}', expect: {'PulseTime3_Set': 300, 'PulseTime3_Remaining': 250}},
};

// Encrypt helper for password
function encryptLegacy(key, value) {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

// Run integration tests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('MQTT Server Tests', (getHarness) => {
            let harness;
            let mqttClientEmitter;
            let mqttClientDetector;
            let lastReceivedTopic1 = null;
            let lastReceivedMessage1 = null;
            let lastReceivedTopic2 = null;
            let lastReceivedMessage2 = null;

            before(async function() {
                this.timeout(60000);
                harness = getHarness();

                // Get system.config to encrypt password
                const systemConfig = await harness.objects.getObjectAsync('system.config');
                const secret = (systemConfig && systemConfig.native && systemConfig.native.secret) || 'Zgfr56gFe87jJOM';

                // Configure adapter
                await harness.changeAdapterConfig('sonoff', {
                    native: {
                        user: 'user',
                        password: encryptLegacy(secret, 'pass1'),
                        TELE_MARGINS: true,
                        STAT_RESULT: true
                    }
                });

                // Start adapter
                await harness.startAdapterAndWait();

                // Wait for adapter to initialize MQTT server
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Start MQTT test clients
                mqttClientEmitter = new MqttClient(
                    (connected) => {
                        if (connected) {
                            console.log('Test MQTT Emitter connected to broker');
                        }
                    },
                    (topic, message) => {
                        lastReceivedTopic1 = topic;
                        lastReceivedMessage1 = message ? message.toString() : null;
                    },
                    { name: 'Emitter*1', user: 'user', pass: 'pass1' }
                );

                mqttClientDetector = new MqttClient(
                    (connected) => {
                        if (connected) {
                            console.log('Test MQTT Detector connected to broker');
                        }
                    },
                    (topic, message) => {
                        lastReceivedTopic2 = topic;
                        lastReceivedMessage2 = message ? message.toString() : null;
                    },
                    { name: 'Detector-1', user: 'user', pass: 'pass1' }
                );

                // Wait for clients to connect
                await new Promise(resolve => setTimeout(resolve, 2000));
            });

            after(async function() {
                this.timeout(10000);
                if (mqttClientEmitter) {
                    mqttClientEmitter.stop();
                }
                if (mqttClientDetector) {
                    mqttClientDetector.stop();
                }
            });

            it('Should have adapter connected with clients', async function() {
                this.timeout(5000);

                // Check if adapter has connection info
                const connectionState = await harness.states.getStateAsync('sonoff.0.info.connection');
                if (!connectionState) {
                    throw new Error('connectionState not found');
                }
                if (typeof connectionState.val !== 'string') {
                    throw new Error('typeof connectionState is not string');
                }
                // Should have at least one client connected
                expect(connectionState.val.indexOf(',')).to.not.equal(-1);
            });

            // Create tests for each MQTT rule
            for (const topic in rules) {
                const rule = rules[topic];

                it(`Should process MQTT message: ${topic}`, async function() {
                    this.timeout(3000);

                    // Publish message
                    await new Promise((resolve, reject) => {
                        mqttClientEmitter.publish(topic, rule.send, (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                    });

                    // Wait for message to be processed
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Check expected states
                    for (const stateId in rule.expect) {
                        const expectedValue = rule.expect[stateId];
                        const fullStateId = `sonoff.0.Emitter_1.${stateId}`;

                        if (expectedValue !== null) {
                            // Object and state should exist
                            const obj = await harness.objects.getObjectAsync(fullStateId);
                            expect(obj, `Object ${fullStateId} should exist`).to.exist;
                            expect(obj.type).to.equal('state');

                            const state = await harness.states.getStateAsync(fullStateId);
                            expect(state, `State ${fullStateId} should exist`).to.exist;
                            expect(state.val).to.equal(expectedValue);
                            expect(state.ack).to.be.true;
                        } else {
                            // State should not exist or object should not exist
                            const obj = await harness.objects.getObjectAsync(fullStateId);
                            expect(obj, `Object ${fullStateId} should not exist`).to.be.null;
                        }
                    }
                });
            }

            it('Should send command to MQTT when state changes', async function() {
                this.timeout(5000);

                // Clear received messages
                lastReceivedTopic1 = null;
                lastReceivedMessage1 = null;
                lastReceivedTopic2 = null;
                lastReceivedMessage2 = null;

                // Change state
                await harness.states.setStateAsync('sonoff.0.Emitter_1.POWER', false, false);

                // Wait for MQTT message
                await new Promise(resolve => setTimeout(resolve, 1500));

                // Check if message was received
                const receivedTopic = lastReceivedTopic1 || lastReceivedTopic2;
                const receivedMessage = lastReceivedMessage1 || lastReceivedMessage2;

                expect(receivedTopic).to.equal('cmnd/tasmota_0912A7/POWER');
                expect(receivedMessage).to.equal('OFF');
            });

            it('Should have correct role for ENERGY.Power object', async function() {
                const obj = await harness.objects.getObjectAsync('sonoff.0.Emitter_1.ENERGY.Power');
                expect(obj).to.exist;
                expect(obj.common.role).to.equal('value.power');
            });

            it('Should have correct unit for BMP280_Pressure object', async function() {
                const obj = await harness.objects.getObjectAsync('sonoff.0.Emitter_1.BMP280_Pressure');
                expect(obj).to.exist;
                expect(obj.common.unit).to.equal('mmHg');
            });

            it('Should have correct units for BME280 object', async function() {
                const pressureObj = await harness.objects.getObjectAsync('sonoff.0.Emitter_1.BME280_Pressure');
                expect(pressureObj).to.exist;
                expect(pressureObj.common.unit).to.equal('mmHg');

                const tempObj = await harness.objects.getObjectAsync('sonoff.0.Emitter_1.BME280_Temperature');
                expect(tempObj).to.exist;
                expect(tempObj.common.unit).to.equal('F');
            });

            it('Should handle Zigbee device control', async function() {
                this.timeout(5000);

                // First send a Zigbee SENSOR message to create device states
                await new Promise((resolve, reject) => {
                    mqttClientEmitter.publish('tele/Emitter_1/SENSOR',
                        '{"Time":"2022-05-05T20:49:08","ZbReceived":{"0x0856":{"Device":"0x0856","Name":"E14 Bulb","Power":0,"Dimmer":50,"Endpoint":1,"LinkQuality":65}}}',
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                // Clear received messages
                lastReceivedTopic1 = null;
                lastReceivedMessage1 = null;
                lastReceivedTopic2 = null;
                lastReceivedMessage2 = null;

                // Change Zigbee Power state
                await harness.states.setStateAsync('sonoff.0.Emitter_1.ZbReceived_0x0856_Power', true, false);

                // Wait for ZbSend command
                await new Promise(resolve => setTimeout(resolve, 200));

                // Check if ZbSend command was published
                const receivedTopic = lastReceivedTopic1 || lastReceivedTopic2;
                const receivedMessage = lastReceivedMessage1 || lastReceivedMessage2;

                expect(receivedTopic).to.exist;
                expect(receivedTopic).to.contain('ZbSend');
                expect(receivedMessage).to.exist;

                const zbCommand = JSON.parse(receivedMessage);
                expect(zbCommand.device).to.equal('0x0856');
                expect(zbCommand.send.Power).to.equal('1');
            });

            it('Should handle Zigbee dimmer control', async function() {
                this.timeout(5000);

                // First send a Zigbee SENSOR message to create device states
                await new Promise((resolve, reject) => {
                    mqttClientEmitter.publish('tele/Emitter_1/SENSOR',
                        '{"Time":"2022-05-05T20:49:08","ZbReceived":{"0x1234":{"Device":"0x1234","Name":"Test Dimmer","Power":1,"Dimmer":50,"Endpoint":1,"LinkQuality":70}}}',
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                // Clear received messages
                lastReceivedTopic1 = null;
                lastReceivedMessage1 = null;
                lastReceivedTopic2 = null;
                lastReceivedMessage2 = null;

                // Change Zigbee Dimmer state
                await harness.states.setStateAsync('sonoff.0.Emitter_1.ZbReceived_0x1234_Dimmer', 75, false);

                // Wait for ZbSend command
                await new Promise(resolve => setTimeout(resolve, 200));

                // Check if ZbSend command was published
                const receivedTopic = lastReceivedTopic1 || lastReceivedTopic2;
                const receivedMessage = lastReceivedMessage1 || lastReceivedMessage2;

                expect(receivedTopic).to.exist;
                expect(receivedTopic).to.contain('ZbSend');
                expect(receivedMessage).to.exist;

                const zbCommand = JSON.parse(receivedMessage);
                expect(zbCommand.device).to.equal('0x1234');
                expect(zbCommand.send.Dimmer).to.equal(75);
            });

            it('Should handle shutter position command transformation', async function() {
                this.timeout(5000);

                // First send a shutter RESULT message to create device states
                await new Promise((resolve, reject) => {
                    mqttClientEmitter.publish('stat/TM_Shutter/RESULT',
                        '{"Shutter1":{"Position":56,"Direction":0,"Target":56,"Tilt":0}}',
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                // Clear received messages
                lastReceivedTopic1 = null;
                lastReceivedMessage1 = null;
                lastReceivedTopic2 = null;
                lastReceivedMessage2 = null;

                // Change Shutter1_Position state
                await harness.states.setStateAsync('sonoff.0.Emitter_1.Shutter1_Position', 49, false);

                // Wait for ShutterPosition command
                await new Promise(resolve => setTimeout(resolve, 200));

                // Check if ShutterPosition command was published
                const receivedTopic = lastReceivedTopic1 || lastReceivedTopic2;
                const receivedMessage = lastReceivedMessage1 || lastReceivedMessage2;

                expect(receivedTopic).to.exist;
                // The adapter sends to the last known device topic (sonoff_4ch in this case from previous tests)
                expect(receivedTopic).to.match(/cmnd\/.+\/ShutterPosition1/);
                expect(receivedMessage).to.equal('49');
            });

            it('Should handle shutter tilt command transformation', async function() {
                this.timeout(5000);

                // First send a shutter RESULT message to create device states
                await new Promise((resolve, reject) => {
                    mqttClientEmitter.publish('stat/TM_Shutter/RESULT',
                        '{"Shutter2":{"Position":75,"Direction":1,"Target":100,"Tilt":25}}',
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        });
                });

                await new Promise(resolve => setTimeout(resolve, 500));

                // Clear received messages
                lastReceivedTopic1 = null;
                lastReceivedMessage1 = null;
                lastReceivedTopic2 = null;
                lastReceivedMessage2 = null;

                // Change Shutter2_Tilt state
                await harness.states.setStateAsync('sonoff.0.Emitter_1.Shutter2_Tilt', 80, false);

                // Wait for ShutterTilt command
                await new Promise(resolve => setTimeout(resolve, 200));

                // Check if ShutterTilt command was published
                const receivedTopic = lastReceivedTopic1 || lastReceivedTopic2;
                const receivedMessage = lastReceivedMessage1 || lastReceivedMessage2;

                expect(receivedTopic).to.exist;
                // The adapter sends to the last known device topic (sonoff_4ch in this case from previous tests)
                expect(receivedTopic).to.match(/cmnd\/.+\/ShutterTilt2/);
                expect(receivedMessage).to.equal('80');
            });
        });
    }
});
