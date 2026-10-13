/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { buildMqttCommand, configureMqtt, probeDevice, scanNetwork } = require('../build/lib/discovery');

const STATUS = {
    Status: { DeviceName: 'Kitchen', FriendlyName: ['Kitchen'], Topic: 'tasmota_ABCDEF' },
    StatusFWR: { Version: '14.2.0(tasmota)' },
    StatusNET: { Hostname: 'tasmota-ABCDEF-1234', Mac: 'AA:BB:CC:AB:CD:EF' },
    StatusMQT: { MqttHost: '', MqttPort: 1883, MqttUser: 'DVES_USER', MqttClient: 'DVES_ABCDEF' },
};

/**
 * Starts a web server which answers like a Tasmota device
 *
 * @param options.password web password of the device
 * @param options.notTasmota answers like some other device with a web server
 */
async function startDevice(options = {}) {
    const commands = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (options.basicAuth) {
            // e.g. a Shelly with a password answers every request like this
            res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Shelly"', 'Content-Type': 'text/plain' });
            res.end('401 Unauthorized');
            return;
        }
        if (options.notTasmota || url.pathname !== '/cm') {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        if (options.password && url.searchParams.get('password') !== options.password) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('{"WARNING":"Need user=<username>&password=<password>"}');
            return;
        }
        const command = url.searchParams.get('cmnd');
        commands.push(command);
        let answer = {};
        if (command === 'Status 0') {
            answer = STATUS;
        } else if (command === 'SetOption3') {
            answer = { SetOption3: 'OFF' };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { address: `127.0.0.1:${server.address().port}`, commands, close: () => server.close() };
}

describe('Search for Tasmota devices', () => {
    it('reads the status of a device', async () => {
        const device = await startDevice();
        assert.deepStrictEqual(await probeDevice(device.address), {
            ip: device.address,
            protected: false,
            name: 'Kitchen',
            hostname: 'tasmota-ABCDEF-1234',
            mac: 'AA:BB:CC:AB:CD:EF',
            version: '14.2.0(tasmota)',
            topic: 'tasmota_ABCDEF',
            mqttHost: '',
            mqttPort: 1883,
            mqttUser: 'DVES_USER',
            mqttClient: 'DVES_ABCDEF',
            mqttEnabled: false,
        });
        device.close();
    });

    it('finds the devices, also with a web password, but no other web servers', async () => {
        const open = await startDevice();
        const secured = await startDevice({ password: 'secret' });
        const other = await startDevice({ notTasmota: true });
        const shelly = await startDevice({ basicAuth: true });

        const found = await scanNetwork(undefined, [
            open.address,
            secured.address,
            other.address,
            shelly.address,
            '127.0.0.1:1',
        ]);
        assert.deepStrictEqual(found.map(d => [d.ip, d.protected]).sort(), [
            [open.address, false],
            [secured.address, true],
        ].sort());

        open.close();
        secured.close();
        other.close();
        shelly.close();
    });

    it('enables MQTT and connects the device with the broker', async () => {
        const device = await startDevice({ password: 'secret' });
        const settings = { host: '192.168.1.2', port: 1883, user: 'iob', password: 'pass' };

        await assert.rejects(configureMqtt(device.address, settings), /web password/);
        await configureMqtt(device.address, settings, 'secret');
        assert.deepStrictEqual(device.commands, [
            'Backlog SetOption3 1; MqttHost 192.168.1.2; MqttPort 1883; MqttUser iob; MqttPassword pass',
        ]);

        device.close();
    });

    // dm-utils sends every message to the GUI as the answer to the previous one. A progress update which
    // is sent before the previous one was confirmed mixes up the answers, so "close" never arrives and the
    // progress dialog stays open forever.
    it('closes the progress dialog before the search result is shown', async () => {
        require('./lib/adapterCoreMock');
        const { setup, delay } = require('./lib/mqttMock');
        const SonoffDeviceManagement = require('../build/lib/deviceManager').default;

        const log = [];
        let busy = false;
        let progressOpen = false;
        const send = async (name, result) => {
            if (busy) {
                throw new Error(`"${name}" was sent before the GUI answered the previous message`);
            }
            busy = true;
            log.push(name);
            await delay(10);
            busy = false;
            return result;
        };
        const context = {
            openProgress: async () => {
                await send('open');
                progressOpen = true;
                return {
                    update: () => send('update'),
                    close: async () => {
                        await send('close');
                        progressOpen = false;
                    },
                };
            },
            showForm: async () => {
                assert.strictEqual(progressOpen, false, 'the progress dialog must be closed before the form');
                return send('form', undefined);
            },
            showMessage: () => send('message'),
        };

        const device = await startDevice();
        const { adapter, bridge } = setup();
        const dm = new SonoffDeviceManagement(adapter);
        // closed ports answer at once, so the progress changes faster than the GUI confirms it
        const addresses = [device.address, ...Array.from({ length: 30 }, (_, i) => `127.0.0.1:${i + 1}`)];

        assert.deepStrictEqual(await dm.handleDiscoverDevices(context, addresses), { refresh: false });
        assert.strictEqual(progressOpen, false);
        assert.strictEqual(log[log.length - 2], 'close');
        assert.strictEqual(log[log.length - 1], 'form');

        device.close();
        await bridge.destroy();
    });

    it('clears user and password if there are none, and rejects ";"', () => {
        assert.strictEqual(
            buildMqttCommand({ host: '10.0.0.1', port: 1884, user: '', password: '' }),
            'Backlog SetOption3 1; MqttHost 10.0.0.1; MqttPort 1884; MqttUser 0; MqttPassword 0',
        );
        assert.throws(() => buildMqttCommand({ host: '10.0.0.1', port: 1883, user: 'a', password: 'x;y' }), /;/);
    });
});
