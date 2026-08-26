/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

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

const MQTTBridge = require('../../build/lib/bridge').default;

// ------------------------------------------------------------------------
// Minimal in-memory implementation of the used adapter functions
// ------------------------------------------------------------------------
function createAdapter(config) {
    const objects = {};
    const states = {};
    const handlers = {};
    const toId = id => (id.startsWith('sonoff.0.') ? id : `sonoff.0.${id}`);
    const toRegExp = pattern => new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);

    const adapter = {
        namespace: 'sonoff.0',
        config,
        objects,
        states,
        // set by "setup", mirrors what main.ts does with the running server/bridge
        server: null,
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
        extendForeignObjectAsync: async (id, obj) => {
            objects[id] = {
                ...objects[id],
                ...obj,
                common: { ...objects[id]?.common, ...obj.common },
                _id: id,
            };
            return objects[id];
        },
        delForeignObjectAsync: async id => {
            delete objects[id];
            delete states[id];
        },
        delForeignStateAsync: async id => {
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
            states[id] = { val: state.val, ack: !!state.ack, ts: states[id] ? states[id].ts + 1 : 1 };
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
        // --- used by the device manager -------------------------------------
        on: (event, handler) => {
            handlers[event] = handler;
        },
        emit: (event, ...args) => handlers[event] && handlers[event](...args),
        getChannelsOfAsync: async () => Object.values(objects).filter(obj => obj.type === 'channel'),
        getStatesOfAsync: async () => Object.values(objects).filter(obj => obj.type === 'state'),
        subscribeStatesAsync: async () => {},
        subscribeObjectsAsync: async () => {},
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
    adapter.server = bridge;
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

module.exports = { createAdapter, setup, delay, FakeMqttClient };
