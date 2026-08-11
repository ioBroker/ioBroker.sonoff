/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const EventEmitter = require('node:events');

// ------------------------------------------------------------------------
// The bridge connects to a real broker with the "mqtt" package. Replace it
// with a fake client, so the message processing can be tested without network
// ------------------------------------------------------------------------
class FakeMqttClient extends EventEmitter {
    constructor() {
        super();
        this.published = [];
        this.subscriptions = [];
    }

    subscribe(topics, options, cb) {
        this.subscriptions.push(...(Array.isArray(topics) ? topics : [topics]));
        if (typeof cb === 'function') {
            cb(null);
        }
    }

    publish(topic, payload) {
        this.published.push({ topic, payload: payload === undefined ? '' : payload.toString() });
    }

    end(force, options, cb) {
        if (typeof cb === 'function') {
            cb();
        }
    }
}

let currentClient = null;

const fakeConnect = (url, options) => {
    currentClient.url = url;
    currentClient.options = options;
    return currentClient;
};

const mqttPath = require.resolve('mqtt');
require.cache[mqttPath] = {
    id: mqttPath,
    filename: mqttPath,
    loaded: true,
    exports: {
        connect: fakeConnect,
        default: { connect: fakeConnect },
    },
};

const MQTTBridge = require('../build/lib/bridge').default;

// ------------------------------------------------------------------------
// Minimal in-memory implementation of the used adapter functions
// ------------------------------------------------------------------------
function createAdapter(config) {
    const objects = {};
    const states = {};
    const toId = id => (id.startsWith('sonoff.0.') ? id : `sonoff.0.${id}`);
    const toRegExp = pattern => new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);

    const adapter = {
        namespace: 'sonoff.0',
        config,
        objects,
        states,
        log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: err => console.error(`Adapter error: ${err}`),
        },
        setForeignObjectAsync: async (id, obj) => {
            objects[id] = { ...JSON.parse(JSON.stringify(obj)), _id: id };
        },
        getForeignObjectAsync: async id => objects[id] || null,
        delForeignObjectAsync: async id => {
            delete objects[id];
            delete states[id];
        },
        getForeignObjectsAsync: async pattern => {
            const regExp = toRegExp(pattern);
            const result = {};
            Object.keys(objects).forEach(id => regExp.test(id) && (result[id] = objects[id]));
            return result;
        },
        setObjectAsync: (id, obj) => adapter.setForeignObjectAsync(toId(id), obj),
        getObjectAsync: id => adapter.getForeignObjectAsync(toId(id)),
        setForeignStateAsync: async (id, val, ack) => {
            const state = val && typeof val === 'object' && 'val' in val ? val : { val, ack };
            states[id] = { val: state.val, ack: !!state.ack };
        },
        setStateAsync: (id, val, ack) => adapter.setForeignStateAsync(toId(id), val, ack),
        setForeignState: (id, val, ack, cb) =>
            adapter.setForeignStateAsync(id, val, ack).then(() => typeof cb === 'function' && cb()),
        getForeignStateAsync: async id => states[id] || null,
        getForeignState: (id, cb) => cb(null, states[id] || null),
        getStateAsync: id => adapter.getForeignStateAsync(toId(id)),
        getStatesAsync: async pattern => {
            const regExp = toRegExp(toId(pattern));
            const result = {};
            Object.keys(states).forEach(id => regExp.test(id) && (result[id] = states[id]));
            return result;
        },
    };

    return adapter;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup(configOverrides) {
    currentClient = new FakeMqttClient();
    const adapter = createAdapter({
        useExternalBroker: true,
        externalBrokerUrl: 'mqtt://localhost:1883',
        externalBrokerUser: '',
        externalBrokerPassword: '',
        externalBrokerTopics: 'tele/#, stat/#, +/tele/+, +/stat/+, +/led_+/get',
        defaultQoS: 0,
        TELE_SENSOR: true,
        TELE_STATE: true,
        STAT_RESULT: true,
        OBJ_TREE: false,
        ...configOverrides,
    });

    const bridge = new MQTTBridge(adapter);
    const client = currentClient;
    client.emit('connect');

    const send = async (topic, payload) => {
        client.emit('message', topic, Buffer.from(payload), { qos: 0, retain: false });
        // wait till the message and all resulting object/state tasks are processed
        await bridge.queue;
        await delay(50);
    };

    return { adapter, bridge, client, send };
}

describe('MQTT bridge (external broker)', function () {
    this.timeout(10000);

    it('subscribes to the configured topics', async () => {
        const { client, bridge } = setup();
        assert.deepStrictEqual(client.subscriptions, [
            'tele/#',
            'stat/#',
            '+/tele/+',
            '+/stat/+',
            '+/led_+/get',
        ]);
        await bridge.destroy();
    });

    it('uses the configured connection options', async () => {
        const { client, bridge } = setup({
            externalBrokerClientId: 'my_client',
            externalBrokerKeepalive: '30',
            externalBrokerCleanSession: false,
        });
        assert.strictEqual(client.url, 'mqtt://localhost:1883');
        assert.strictEqual(client.options.clientId, 'my_client');
        assert.strictEqual(client.options.keepalive, 30);
        assert.strictEqual(client.options.clean, false);
        assert.strictEqual(client.options.rejectUnauthorized, undefined, 'no TLS options without an encrypted URL');
        await bridge.destroy();
    });

    it('adds the TLS options for encrypted connections', async () => {
        const { client, bridge } = setup({
            externalBrokerUrl: 'mqtts://broker:8883',
            externalBrokerRejectUnauthorized: false,
        });
        assert.strictEqual(client.url, 'mqtts://broker:8883');
        assert.strictEqual(client.options.rejectUnauthorized, false);
        await bridge.destroy();
    });

    it('buffers messages of unknown devices and names them by their MQTT client ID', async () => {
        const { adapter, bridge, client, send } = setup();

        await send('tele/kitchen/SENSOR', '{"Time":"2026-08-11T10:00:00","AM2301":{"Temperature":21.5}}');
        assert.ok(
            client.published.find(p => p.topic === 'cmnd/kitchen/Status' && p.payload === '6'),
            'the device must be asked for its name',
        );
        assert.deepStrictEqual(Object.keys(adapter.objects), [], 'no device may be created before the name is known');

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        assert.ok(adapter.objects['sonoff.0.DVES_123456'], 'device object must exist');
        assert.ok(adapter.objects['sonoff.0.DVES_123456.alive'], 'alive object must exist');
        assert.strictEqual(
            adapter.states['sonoff.0.DVES_123456.AM2301_Temperature']?.val,
            21.5,
            'the buffered message must be processed',
        );

        await bridge.destroy();
    });

    it('processes repeated messages which contain the hostname', async () => {
        const { adapter, bridge, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        await send('tele/kitchen/STATE', '{"Time":"2026-08-11T10:05:00","Hostname":"tasmota-kitchen","POWER":"ON"}');
        await send('tele/kitchen/STATE', '{"Time":"2026-08-11T10:10:00","Hostname":"tasmota-kitchen","POWER":"OFF"}');

        assert.strictEqual(adapter.states['sonoff.0.DVES_123456.POWER']?.val, false, 'the second STATE must be stored');
        assert.ok(
            !adapter.objects['sonoff.0.tasmota-kitchen'],
            'the hostname must not rename a device which is named by its MQTT client ID',
        );

        await bridge.destroy();
    });

    it('requests and stores the device information', async () => {
        const { adapter, bridge, client, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        assert.ok(client.published.find(p => p.topic === 'cmnd/kitchen/Status' && p.payload === '5'));
        assert.ok(client.published.find(p => p.topic === 'cmnd/kitchen/Status' && p.payload === '2'));

        await send('stat/kitchen/STATUS5', '{"StatusNET":{"Hostname":"tasmota-kitchen","IPAddress":"192.168.1.55"}}');
        assert.strictEqual(adapter.states['sonoff.0.DVES_123456.INFO.IPAddress']?.val, '192.168.1.55');

        await bridge.destroy();
    });

    it('sets alive from the last will topic', async () => {
        const { adapter, bridge, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        await send('tele/kitchen/LWT', 'Offline');
        assert.strictEqual(adapter.states['sonoff.0.DVES_123456.alive']?.val, false);

        await send('tele/kitchen/LWT', 'Online');
        assert.strictEqual(adapter.states['sonoff.0.DVES_123456.alive']?.val, true);

        await bridge.destroy();
    });

    it('maps commands to cmnd, also for nested full topics', async () => {
        const { bridge, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        await send('stat/kitchen/POWER', 'ON');
        assert.strictEqual(bridge.clients.DVES_123456?._map?.POWER, 'cmnd/kitchen/POWER');

        await send('stat/house/floor1/lamp/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_ABCDEF"}}');
        await send('stat/house/floor1/lamp/POWER', 'ON');
        assert.strictEqual(bridge.clients.DVES_ABCDEF?._map?.POWER, 'cmnd/house/floor1/lamp/POWER');

        await bridge.destroy();
    });

    it('supports the device-first full topic (%topic%/%prefix%/)', async () => {
        const { adapter, bridge, client, send } = setup();

        await send('lamp/tele/STATE', '{"Time":"2026-08-11T10:00:00","POWER":"ON"}');
        assert.ok(
            client.published.find(p => p.topic === 'lamp/cmnd/Status' && p.payload === '6'),
            'the status request must use the structure of the device',
        );

        await send('lamp/stat/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_AAAAAA"}}');
        assert.ok(adapter.objects['sonoff.0.DVES_AAAAAA'], 'the device must be created');
        assert.strictEqual(
            adapter.states['sonoff.0.DVES_AAAAAA.POWER']?.val,
            true,
            'the buffered STATE must be processed like a standard topic',
        );

        await send('lamp/stat/POWER', 'ON');
        assert.strictEqual(bridge.clients.DVES_AAAAAA?._map?.POWER, 'cmnd/lamp/POWER');

        // a command must be published in the structure of the device
        client.published.length = 0;
        await bridge.onStateChange('sonoff.0.DVES_AAAAAA.POWER', { val: false, ack: false });
        await delay(50);
        assert.deepStrictEqual(client.published, [{ topic: 'lamp/cmnd/POWER', payload: 'OFF' }]);

        await bridge.destroy();
    });

    it('does not mix up the structures of different devices', async () => {
        const { bridge, client, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"standard_device"}}');
        await send('stat/kitchen/POWER', 'ON');
        await send('lamp/stat/STATUS6', '{"StatusMQT":{"MqttClient":"first_device"}}');
        await send('lamp/stat/POWER', 'ON');

        client.published.length = 0;
        await bridge.onStateChange('sonoff.0.standard_device.POWER', { val: true, ack: false });
        await bridge.onStateChange('sonoff.0.first_device.POWER', { val: true, ack: false });
        await delay(50);

        assert.deepStrictEqual(client.published, [
            { topic: 'cmnd/kitchen/POWER', payload: 'ON' },
            { topic: 'lamp/cmnd/POWER', payload: 'ON' },
        ]);

        await bridge.destroy();
    });

    it('supports devices without tasmota topics (OpenBeken)', async () => {
        const { adapter, bridge, client, send } = setup();

        await send('obk8D34A2/led_dimmer/get', '42');
        assert.ok(adapter.objects['sonoff.0.obk8D34A2'], 'the device must be created immediately');
        assert.strictEqual(adapter.states['sonoff.0.obk8D34A2.led_dimmer']?.val, 42);
        assert.ok(
            !client.published.find(p => p.topic.startsWith('cmnd/obk8D34A2/')),
            'no tasmota status commands may be sent to such devices',
        );

        await bridge.destroy();
    });

    it('renames the objects if the MQTT client ID of a device changes', async () => {
        const { adapter, bridge, send } = setup();

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        await send('stat/kitchen/STATUS5', '{"StatusNET":{"IPAddress":"192.168.1.55"}}');
        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"kitchen_new"}}');

        assert.ok(adapter.objects['sonoff.0.kitchen_new'], 'the device must exist with the new name');
        assert.ok(!adapter.objects['sonoff.0.DVES_123456'], 'the old objects must be deleted');
        assert.strictEqual(
            adapter.states['sonoff.0.kitchen_new.INFO.IPAddress']?.val,
            '192.168.1.55',
            'the states must be moved too',
        );

        await bridge.destroy();
    });

    it('uses the topic as name if the device does not answer', async () => {
        const { adapter, bridge, send } = setup();

        await send('tele/silent/SENSOR', '{"Time":"2026-08-11T10:00:00","Analog0":298}');
        assert.ok(!adapter.objects['sonoff.0.silent'], 'nothing may be created before the timeout');

        // do not wait 30 seconds for the timer
        await bridge.fallbackToTopicPrefix('silent');
        await delay(50);

        assert.ok(adapter.objects['sonoff.0.silent'], 'the device must be created with the topic as name');
        assert.strictEqual(adapter.states['sonoff.0.silent.Analog0']?.val, 298);

        await bridge.destroy();
    });
});
