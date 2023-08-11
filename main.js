/**
 *
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017-2023 bluefox
 *
 *      MIT License
 *
 */
'use strict';

const utils       = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();
const Server      = require('./lib/server');
let   server      = null;
let   adapter;

function decrypt(key, value) {
    let result = '';
    for (let i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, { name: adapterName });

    adapter = new utils.Adapter(options);

    adapter.on('ready', () => {
        // delete pass if a password set
        if (adapter.config.password && adapter.config.pass) {
            // delete adapter.config.pass
            adapter.getForeignObject(`system.adapter.${adapter.namespace}`, (err, config) => {
                delete config.native.pass;
                adapter.setForeignObject(config._id, config);
            });
        } else if (!adapter.config.password && adapter.config.pass) {
            // migrate
            adapter.getForeignObject('system.config', (err, systemConfig) => {
                adapter.getForeignObject(`system.adapter.${adapter.namespace}`, (err, config) => {
                    if (systemConfig && systemConfig.native && systemConfig.native.secret) {
                        // noinspection JSUnresolvedVariable
                        config.native.password = decrypt(systemConfig.native.secret, adapter.config.pass);
                    } else {
                        // noinspection JSUnresolvedVariable
                        config.native.password = decrypt('Zgfr56gFe87jJOM', adapter.config.pass);
                    }
                    delete config.native.pass;
                    adapter.setForeignObject(config._id, config);
                });
            });
        } else {
            main();
        }
    });

    adapter.on('unload', cb => {
        if (server) {
            server.destroy(cb);
            server = null;
        } else if (typeof cb === 'function') {
            cb();
        }
    });

    // called if the subscribed state changes itself
    adapter.on('stateChange', (id, state) => {
        adapter.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
        // you can use the ack flag to detect if state is desired or acknowledged
        state && !state.ack && server && server.onStateChange(id, state);
    });
    return adapter;
}

function main() {
    adapter.config.TELE_SENSOR = adapter.config.TELE_SENSOR === true || adapter.config.TELE_SENSOR === 'true';
    adapter.config.TELE_STATE  = adapter.config.TELE_STATE  === true || adapter.config.TELE_STATE  === 'true';
    adapter.config.STAT_RESULT = adapter.config.STAT_RESULT === true || adapter.config.STAT_RESULT === 'true';
    adapter.config.OBJ_TREE    = adapter.config.OBJ_TREE    === true || adapter.config.OBJ_TREE    === 'true';

    // subscribe for all own variables
    adapter.subscribeStates('*');

    // read all states and set alive to false
    adapter.getStatesOf('', '', (err, states) =>
        states && states.length && states.forEach(state =>
                state._id.match(/\.alive$/) && adapter.setForeignState(state._id, false, true)));

    server = new Server(adapter);
}

// If started as allInOne/compact mode => return function to create instance
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
