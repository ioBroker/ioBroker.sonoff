/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
// creates the self-signed certificate like js-controller does for the default certificates of ioBroker
const forge = require('node-forge');
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

/** A self-signed certificate for "localhost", created for the test, so no private key is in the repository */
function createCertificate() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
    return { key: privateKey, cert: forge.pki.certificateToPem(cert) };
}

/**
 * Connects once like a device and resolves with the return code of CONNACK: 0 = accepted, 4 = wrong user or
 * password, -1 = the connection was closed without an answer (the server closes the socket right after
 * refusing, so the CONNACK does not always arrive)
 */
function connectOnce(port, clientId, password, secure) {
    return new Promise(resolve => {
        // like Tasmota with SetOption132 1: the self-signed certificate is accepted
        const stream = secure
            ? tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false })
            : net.createConnection(port, '127.0.0.1');
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
        stream.on(secure ? 'secureConnect' : 'connect', () =>
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

    // https://github.com/ioBroker/ioBroker.sonoff/issues/529
    it('accepts the devices over TLS (MQTTS)', async () => {
        const port = await getFreePort();
        const adapter = createAdapter({ port, bind: '127.0.0.1', user: 'user', password: 'secret', defaultQoS: 0 });
        const infos = [];
        adapter.log.info = text => infos.push(text);
        const server = new MQTTServer(adapter, createCertificate());
        await delay(100);
        assert.ok(
            infos.some(text => text.startsWith('Starting MQTT secure (TLS) authenticated server')),
            infos.join('\n'),
        );

        assert.strictEqual(await connectOnce(port, 'DVES_TLS', 'secret', true), 0, 'the login over TLS must work');
        await delay(100);
        assert.ok(adapter.objects['sonoff.0.DVES_TLS'], 'the device must be created');
        assert.notStrictEqual(await connectOnce(port, 'DVES_TLS', 'wrong', true), 0, 'the password is still checked');

        await server.destroy();
    });

    it('reports a device without TLS on the MQTTS port only once per hour', async () => {
        const port = await getFreePort();
        const adapter = createAdapter({ port, bind: '127.0.0.1', user: '', password: '', defaultQoS: 0 });
        const warnings = [];
        const debugs = [];
        adapter.log.warn = text => warnings.push(text);
        adapter.log.debug = text => debugs.push(text);
        const server = new MQTTServer(adapter, createCertificate());
        await delay(100);

        for (let i = 0; i < 3; i++) {
            assert.notStrictEqual(await connectOnce(port, 'plain', 'x', false), 0, 'plain MQTT must be refused');
        }
        await delay(100);
        const tlsWarnings = warnings.filter(text => text.startsWith('TLS connection from'));
        assert.strictEqual(tlsWarnings.length, 1, warnings.join('\n'));
        assert.match(tlsWarnings[0], /SetOption103 1/);
        assert.strictEqual(debugs.filter(text => text.startsWith('TLS connection from')).length, 2);
        assert.ok(!adapter.objects['sonoff.0.plain'], 'no device may be created');

        await server.destroy();
    });
});
