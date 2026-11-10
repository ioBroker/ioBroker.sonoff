/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const net = require('node:net');
// not the "mqtt" package: "./lib/mqttMock" replaces it with a fake client for the bridge tests
const mqttConnection = require('mqtt-connection');
const { createAdapter, delay } = require('./lib/mqttMock');
const MQTTServer = require('../build/lib/server').default;

async function getFreePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

/**
 * Connects once like a device and resolves with the return code of CONNACK: 0 = accepted, 4 = wrong user or
 * password, -1 = the connection was closed without an answer (the server closes the socket right after
 * refusing, so the CONNACK does not always arrive)
 */
function connectOnce(port, clientId, password) {
    return new Promise(resolve => {
        const stream = net.createConnection(port, '127.0.0.1');
        const client = mqttConnection(stream);
        let done = false;
        const finish = returnCode => {
            if (!done) {
                done = true;
                stream.destroy();
                resolve(returnCode);
            }
        };
        client.on('connack', packet => finish(packet.returnCode));
        client.on('close', () => finish(-1));
        client.on('error', () => finish(-1));
        stream.on('connect', () =>
            client.connect({
                protocolId: 'MQTT',
                protocolVersion: 4,
                clientId,
                username: 'user',
                password: Buffer.from(password),
                keepalive: 60,
                clean: true,
            }),
        );
    });
}

describe('MQTT server (built-in broker)', function () {
    this.timeout(10000);

    // https://github.com/ioBroker/ioBroker.sonoff/issues/548
    it('warns about a wrong password only once and not on every retry of the device', async () => {
        const port = await getFreePort();
        const adapter = createAdapter({ port, bind: '127.0.0.1', user: 'user', password: 'secret', defaultQoS: 0 });
        const warnings = [];
        const debugs = [];
        adapter.log.warn = text => warnings.push(text);
        adapter.log.debug = text => debugs.push(text);
        const server = new MQTTServer(adapter);
        await delay(100);

        for (let i = 0; i < 3; i++) {
            assert.notStrictEqual(await connectOnce(port, 'speedy', 'wrong'), 0, 'the connection must be refused');
        }
        const authWarnings = () => warnings.filter(text => text.includes('invalid password'));
        assert.strictEqual(authWarnings().length, 1, warnings.join('\n'));
        assert.match(authWarnings()[0], /^Client \[speedy\] has invalid password or username\./);
        assert.strictEqual(debugs.filter(text => text.includes('[speedy] has invalid password')).length, 2);

        // another device is reported on its own
        assert.notStrictEqual(await connectOnce(port, 'cs720', 'wrong'), 0);
        assert.strictEqual(authWarnings().length, 2, warnings.join('\n'));
        assert.match(authWarnings()[1], /^Client \[cs720\]/);

        // after a successful login a wrong password is reported at once again
        assert.strictEqual(await connectOnce(port, 'speedy', 'secret'), 0);
        await delay(100);
        assert.notStrictEqual(await connectOnce(port, 'speedy', 'wrong'), 0);
        assert.strictEqual(authWarnings().length, 3, warnings.join('\n'));

        await server.destroy();
    });
});
