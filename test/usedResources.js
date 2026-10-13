/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const net = require('node:net');
const { createAdapter, delay } = require('./lib/mqttMock');
const MQTTServer = require('../build/lib/server').default;
const { findPortHolders, registerTcpPort } = require('../build/lib/usedResources');

async function getFreePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function waitFor(check) {
    for (let i = 0; i < 100 && !check(); i++) {
        await delay(20);
    }
}

describe('Used resources', () => {
    it('reports the port of the MQTT server to js-controller', async () => {
        const port = await getFreePort();
        const adapter = createAdapter({ port, bind: '127.0.0.1', user: '', password: '' });
        const registered = [];
        adapter.registerUsedResource = async (type, data) => registered.push({ type, data });

        const server = new MQTTServer(adapter);
        await waitFor(() => registered.length);
        assert.deepStrictEqual(registered, [{ type: 'tcpPort', data: { port, bind: '127.0.0.1' } }]);

        await server.destroy();
    });

    it('names the instance which occupies the port', async () => {
        const blocker = net.createServer();
        await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
        const { port } = blocker.address();

        const adapter = createAdapter({ port, bind: '127.0.0.1', user: '', password: '' });
        const errors = [];
        adapter.log.error = text => errors.push(text);
        adapter.registerUsedResource = async () => assert.fail('the port is not opened, so it is not used');
        adapter.checkUsedResource = async (type, data) => {
            assert.deepStrictEqual([type, data], ['tcpPort', { port }]);
            return [{ instance: 'mqtt.0' }, { instance: 'mqtt.0' }];
        };

        const server = new MQTTServer(adapter);
        await waitFor(() => errors.length);
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0], /EADDRINUSE.*: the port is used by mqtt\.0$/);

        await server.destroy();
        blocker.close();
    });

    it('does nothing with an older js-controller', async () => {
        const adapter = createAdapter({});
        assert.strictEqual(await registerTcpPort(adapter, 1883, '0.0.0.0'), false);
        assert.deepStrictEqual(await findPortHolders(adapter, 1883), []);
    });

    it('omits an empty bind address and ignores errors of the host', async () => {
        const adapter = createAdapter({});
        const warnings = [];
        adapter.log.warn = text => warnings.push(text);
        const registered = [];
        adapter.registerUsedResource = async (type, data) => registered.push(data);
        assert.strictEqual(await registerTcpPort(adapter, 1883, ''), true);
        assert.deepStrictEqual(registered, [{ port: 1883 }]);

        adapter.registerUsedResource = async () => {
            throw new Error('refused');
        };
        assert.strictEqual(await registerTcpPort(adapter, 1883), false);
        assert.match(warnings[0], /refused/);

        // the own instance is not reported as the holder
        adapter.checkUsedResource = async () => [{ instance: 'sonoff.0' }];
        assert.deepStrictEqual(await findPortHolders(adapter, 1883), []);
    });
});
