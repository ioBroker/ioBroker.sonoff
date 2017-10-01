/**
 *
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017 bluefox
 *
 *      MIT License
 *
 */

var utils   = require(__dirname + '/lib/utils'); // Get common adapter utils
var adapter = new utils.Adapter('sonoff');
var Server  = require(__dirname + '/lib/server');
var server  = null;

function decrypt(key, value) {
    var result = '';
    for (var i = 0; i < value.length; ++i) {
        result += String.fromCharCode(key[i % key.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

adapter.on('ready', function () {
    // it must be like this

    adapter.getForeignObject('system.config', function (err, obj) {
        if (obj && obj.native && obj.native.secret) {
            //noinspection JSUnresolvedVariable
            adapter.config.pass = decrypt(obj.native.secret, adapter.config.pass);
        } else {
            //noinspection JSUnresolvedVariable
            adapter.config.pass = decrypt('Zgfr56gFe87jJOM', adapter.config.pass);
        }
        main();
    });
});

adapter.on('unload', function (cb) {
    if (server) {
        server.destroy(cb);
    } else if (cb) {
        cb();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ': ' + JSON.stringify(state));
    // you can use the ack flag to detect if state is desired or acknowledged
    if (state && !state.ack && server) {
        server.onStateChange(id, state);
    }
});

function main() {
    // subscribe for all variables
    adapter.subscribeStates('*');

    // read all states and set alive to false
    adapter.getStatesOf('', '', function (err, states) {
        if (states && states.length) {
            states.forEach(state => {
                if (state._id.match(/\.alive$/)) {
                    adapter.setForeignState(state._id, false, true);
                }
            });
        }
    });

    server = new Server(adapter);
}

