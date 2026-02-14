'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const EventEmitter = require('events');

let aedes;
try {
    aedes = require('aedes');
} catch (e) {
    // Fallback to mqtt-connection if aedes is not available
    // The original adapter used the 'mqtt' package's internal server
}

/**
 * MQTTServer - Built-in MQTT broker for Tasmota devices.
 * This is the original server-mode functionality of the sonoff adapter.
 *
 * Events:
 *   'message'              (topic, message, clientId)
 *   'clientConnected'      (clientId)
 *   'clientDisconnected'   (clientId)
 */
class MQTTServer extends EventEmitter {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} options
     * @param {number} options.port
     * @param {string} options.bind
     * @param {string} options.user
     * @param {string} options.password
     * @param {boolean} options.ssl
     * @param {string} options.certPath
     * @param {string} options.keyPath
     */
    constructor(adapter, options) {
        super();
        this.adapter = adapter;
        this.options = options;
        this.server = null;
        this.broker = null;
        this.clients = {};
    }

    async start() {
        if (!aedes) {
            // Use mqtt-connection based approach (original adapter approach)
            return this.startMqttConnection();
        }

        // Preferred: Use aedes MQTT broker
        this.broker = aedes();

        // Authentication
        if (this.options.user) {
            this.broker.authenticate = (client, username, password, callback) => {
                const passwordStr = password ? password.toString() : '';
                if (username === this.options.user && passwordStr === this.options.password) {
                    callback(null, true);
                } else {
                    this.adapter.log.warn(`Client [${client.id}] has invalid password or username`);
                    callback(null, false);
                }
            };
        }

        // Client connected
        this.broker.on('client', (client) => {
            this.clients[client.id] = client;
            this.emit('clientConnected', client.id);
        });

        // Client disconnected
        this.broker.on('clientDisconnect', (client) => {
            delete this.clients[client.id];
            this.emit('clientDisconnected', client.id);
        });

        // Message published
        this.broker.on('publish', (packet, client) => {
            if (!client) return; // Skip internal/system messages

            const topic = packet.topic;
            const message = packet.payload ? packet.payload.toString() : '';
            this.emit('message', topic, message, client.id);
        });

        return new Promise((resolve, reject) => {
            let server;

            if (this.options.ssl) {
                const tlsOptions = {};
                try {
                    if (this.options.certPath) {
                        tlsOptions.cert = fs.readFileSync(this.options.certPath);
                    }
                    if (this.options.keyPath) {
                        tlsOptions.key = fs.readFileSync(this.options.keyPath);
                    }
                } catch (err) {
                    this.adapter.log.error(`Cannot read SSL certificates: ${err.message}`);
                    return reject(err);
                }
                server = tls.createServer(tlsOptions, this.broker.handle);
            } else {
                server = net.createServer(this.broker.handle);
            }

            this.server = server;

            server.on('error', (err) => {
                this.adapter.log.error(`MQTT Server error: ${err.message}`);
                reject(err);
            });

            server.listen(this.options.port, this.options.bind, () => {
                this.adapter.log.info(
                    `MQTT broker started on ${this.options.bind}:${this.options.port}` +
                    (this.options.ssl ? ' (TLS)' : '') +
                    (this.options.user ? ' (authenticated)' : '')
                );
                resolve();
            });
        });
    }

    /**
     * Fallback server implementation using mqtt-connection package
     * (mirrors original adapter approach when aedes is not available)
     */
    startMqttConnection() {
        const mqttCon = require('mqtt-connection');

        return new Promise((resolve, reject) => {
            const setupHandler = (stream) => {
                const client = mqttCon(stream);
                let clientId = null;
                let authenticated = false;

                client.on('connect', (packet) => {
                    clientId = packet.clientId;

                    // Check authentication
                    if (this.options.user) {
                        const username = packet.username || '';
                        const password = packet.password ? packet.password.toString() : '';
                        if (username !== this.options.user || password !== this.options.password) {
                            this.adapter.log.warn(`Client [${clientId}] has invalid password or username`);
                            client.connack({ returnCode: 4 }); // Bad user name or password
                            client.destroy();
                            return;
                        }
                    }

                    authenticated = true;
                    this.clients[clientId] = client;
                    this.emit('clientConnected', clientId);

                    client.connack({ returnCode: 0 });
                });

                client.on('publish', (packet) => {
                    if (!authenticated) return;

                    const topic = packet.topic;
                    const message = packet.payload ? packet.payload.toString() : '';
                    this.emit('message', topic, message, clientId);

                    // Acknowledge QoS 1 messages
                    if (packet.qos === 1) {
                        client.puback({ messageId: packet.messageId });
                    }
                });

                client.on('subscribe', (packet) => {
                    if (!authenticated) return;

                    const granted = packet.subscriptions.map(sub => sub.qos);
                    client.suback({ messageId: packet.messageId, granted });
                });

                client.on('pingreq', () => {
                    client.pingresp();
                });

                client.on('disconnect', () => {
                    if (clientId) {
                        delete this.clients[clientId];
                        this.emit('clientDisconnected', clientId);
                    }
                    client.destroy();
                });

                client.on('error', (err) => {
                    this.adapter.log.debug(`Client error: ${err.message}`);
                    if (clientId) {
                        delete this.clients[clientId];
                        this.emit('clientDisconnected', clientId);
                    }
                    client.destroy();
                });

                stream.on('error', () => {
                    if (clientId) {
                        delete this.clients[clientId];
                        this.emit('clientDisconnected', clientId);
                    }
                });

                client.on('close', () => {
                    if (clientId) {
                        delete this.clients[clientId];
                        this.emit('clientDisconnected', clientId);
                    }
                });
            };

            let server;
            if (this.options.ssl) {
                const tlsOptions = {};
                try {
                    if (this.options.certPath) tlsOptions.cert = fs.readFileSync(this.options.certPath);
                    if (this.options.keyPath) tlsOptions.key = fs.readFileSync(this.options.keyPath);
                } catch (err) {
                    return reject(err);
                }
                server = tls.createServer(tlsOptions, setupHandler);
            } else {
                server = net.createServer(setupHandler);
            }

            this.server = server;

            server.on('error', (err) => {
                reject(err);
            });

            server.listen(this.options.port, this.options.bind, () => {
                resolve();
            });
        });
    }

    /**
     * Publish a message to a specific connected client or all clients.
     * @param {string} topic
     * @param {string} payload
     * @param {string} [targetClientId]
     */
    publish(topic, payload, targetClientId) {
        if (this.broker) {
            // aedes broker mode
            this.broker.publish({
                topic,
                payload: Buffer.from(payload),
                qos: 0,
                retain: false,
            }, (err) => {
                if (err) {
                    this.adapter.log.error(`Error publishing ${topic}: ${err.message}`);
                }
            });
        } else {
            // mqtt-connection mode
            const packet = {
                topic,
                payload: Buffer.from(payload),
                qos: 0,
                retain: false,
            };

            if (targetClientId && this.clients[targetClientId]) {
                this.clients[targetClientId].publish(packet);
            } else {
                // Publish to all connected clients
                for (const id of Object.keys(this.clients)) {
                    try {
                        this.clients[id].publish(packet);
                    } catch (e) {
                        this.adapter.log.debug(`Error publishing to client ${id}: ${e.message}`);
                    }
                }
            }
        }
    }

    stop() {
        if (this.broker) {
            this.broker.close();
            this.broker = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.clients = {};
    }
}

module.exports = MQTTServer;
