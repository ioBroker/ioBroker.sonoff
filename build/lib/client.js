'use strict';

const mqtt = require('mqtt');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * MQTTClient - Connects to an external MQTT broker and subscribes to Tasmota topics.
 *
 * Events:
 *   'message'       (topic, message, deviceId)
 *   'connected'     ()
 *   'disconnected'  ()
 *   'error'         (error)
 *   'deviceOnline'  (deviceId)
 */
class MQTTClient extends EventEmitter {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} options
     * @param {string} options.url - Full broker URL (mqtt:// or mqtts://)
     * @param {string} options.user
     * @param {string} options.password
     * @param {string} options.clientId
     * @param {boolean} options.useTls
     * @param {boolean} options.rejectUnauthorized
     * @param {string} options.caPath - Path to CA certificate
     * @param {string} options.certPath - Path to client certificate
     * @param {string} options.keyPath - Path to client private key
     * @param {string} options.topicPrefix - Optional topic prefix filter
     * @param {number} options.keepalive
     * @param {number} options.reconnectPeriod
     * @param {boolean} options.cleanSession
     */
    constructor(adapter, options) {
        super();
        this.adapter = adapter;
        this.options = options;
        this.client = null;
        this.connected = false;
        this.knownDevices = new Set();
    }

    async connect() {
        const connectOptions = {
            clientId: this.options.clientId,
            keepalive: this.options.keepalive || 60,
            reconnectPeriod: this.options.reconnectPeriod || 5000,
            clean: this.options.cleanSession !== false,
            protocolVersion: 4, // MQTT 3.1.1
        };

        // Authentication
        if (this.options.user) {
            connectOptions.username = this.options.user;
            connectOptions.password = this.options.password || '';
        }

        // TLS Configuration
        if (this.options.useTls) {
            connectOptions.rejectUnauthorized = this.options.rejectUnauthorized !== false;

            if (this.options.caPath) {
                try {
                    connectOptions.ca = fs.readFileSync(this.options.caPath);
                    this.adapter.log.debug('CA certificate loaded');
                } catch (err) {
                    this.adapter.log.warn(`Cannot read CA certificate: ${err.message}`);
                }
            }

            if (this.options.certPath) {
                try {
                    connectOptions.cert = fs.readFileSync(this.options.certPath);
                    this.adapter.log.debug('Client certificate loaded');
                } catch (err) {
                    this.adapter.log.warn(`Cannot read client certificate: ${err.message}`);
                }
            }

            if (this.options.keyPath) {
                try {
                    connectOptions.key = fs.readFileSync(this.options.keyPath);
                    this.adapter.log.debug('Client key loaded');
                } catch (err) {
                    this.adapter.log.warn(`Cannot read client key: ${err.message}`);
                }
            }
        }

        return new Promise((resolve, reject) => {
            this.adapter.log.info(`Connecting to MQTT broker: ${this.options.url}`);

            this.client = mqtt.connect(this.options.url, connectOptions);

            this.client.on('connect', () => {
                this.connected = true;
                this.adapter.log.info('Successfully connected to external MQTT broker');
                this.emit('connected');

                // Subscribe to Tasmota topics
                this.subscribeToTasmotaTopics();

                resolve();
            });

            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message);
            });

            this.client.on('reconnect', () => {
                this.adapter.log.debug('Reconnecting to MQTT broker...');
            });

            this.client.on('close', () => {
                if (this.connected) {
                    this.connected = false;
                    this.emit('disconnected');
                }
            });

            this.client.on('offline', () => {
                this.connected = false;
                this.adapter.log.debug('MQTT client offline');
            });

            this.client.on('error', (err) => {
                this.adapter.log.error(`MQTT client error: ${err.message}`);
                this.emit('error', err);
                if (!this.connected) {
                    // Don't reject on reconnect errors, only on initial connection
                    // The mqtt library will auto-reconnect
                }
            });

            // Timeout for initial connection
            setTimeout(() => {
                if (!this.connected) {
                    this.adapter.log.warn('Initial MQTT connection timeout - will keep trying to reconnect');
                    resolve(); // Don't block adapter startup
                }
            }, 10000);
        });
    }

    subscribeToTasmotaTopics() {
        const prefix = this.options.topicPrefix ? `${this.options.topicPrefix}/` : '';

        const topics = [
            `${prefix}tele/+/STATE`,
            `${prefix}tele/+/SENSOR`,
            `${prefix}tele/+/RESULT`,
            `${prefix}tele/+/LWT`,
            `${prefix}tele/+/INFO1`,
            `${prefix}tele/+/INFO2`,
            `${prefix}tele/+/INFO3`,
            `${prefix}tele/+/MARGINS`,
            `${prefix}tele/+/WAKEUP`,
            `${prefix}stat/+/RESULT`,
            `${prefix}stat/+/POWER`,
            `${prefix}stat/+/POWER1`,
            `${prefix}stat/+/POWER2`,
            `${prefix}stat/+/POWER3`,
            `${prefix}stat/+/POWER4`,
            `${prefix}stat/+/STATUS`,
            `${prefix}stat/+/STATUS1`,
            `${prefix}stat/+/STATUS2`,
            `${prefix}stat/+/STATUS3`,
            `${prefix}stat/+/STATUS4`,
            `${prefix}stat/+/STATUS5`,
            `${prefix}stat/+/STATUS6`,
            `${prefix}stat/+/STATUS7`,
            `${prefix}stat/+/STATUS8`,
            `${prefix}stat/+/STATUS9`,
            `${prefix}stat/+/STATUS10`,
            `${prefix}stat/+/STATUS11`,
        ];

        // Also subscribe with wildcard for additional topics
        topics.push(`${prefix}tele/+/+`);
        topics.push(`${prefix}stat/+/+`);

        this.client.subscribe(topics, { qos: 0 }, (err) => {
            if (err) {
                this.adapter.log.error(`Error subscribing to Tasmota topics: ${err.message}`);
            } else {
                this.adapter.log.info(`Subscribed to Tasmota topics${prefix ? ` with prefix "${this.options.topicPrefix}"` : ''}`);
            }
        });
    }

    handleMessage(topic, messageBuffer) {
        const message = messageBuffer.toString();
        const prefix = this.options.topicPrefix;

        let effectiveTopic = topic;
        // Strip optional topic prefix
        if (prefix && topic.startsWith(`${prefix}/`)) {
            effectiveTopic = topic.substring(prefix.length + 1);
        }

        const parts = effectiveTopic.split('/');
        if (parts.length < 3) return;

        const deviceId = parts[1];

        // Track new devices
        if (!this.knownDevices.has(deviceId)) {
            this.knownDevices.add(deviceId);
            this.emit('deviceOnline', deviceId);
        }

        // Handle LWT (Last Will and Testament)
        if (parts[0] === 'tele' && parts[2] === 'LWT') {
            if (message === 'Offline') {
                this.knownDevices.delete(deviceId);
            }
        }

        this.emit('message', effectiveTopic, message, deviceId);
    }

    /**
     * Publish a message to the external MQTT broker
     * @param {string} topic
     * @param {string} payload
     * @param {object} [options]
     */
    publish(topic, payload, options) {
        if (!this.client || !this.connected) {
            this.adapter.log.warn(`Cannot publish - not connected to MQTT broker`);
            return;
        }

        const prefix = this.options.topicPrefix;
        const fullTopic = prefix ? `${prefix}/${topic}` : topic;

        this.client.publish(fullTopic, payload, options || { qos: 0, retain: false }, (err) => {
            if (err) {
                this.adapter.log.error(`Error publishing to ${fullTopic}: ${err.message}`);
            } else {
                this.adapter.log.debug(`Published: ${fullTopic} = ${payload}`);
            }
        });
    }

    disconnect() {
        if (this.client) {
            this.connected = false;
            this.client.end(true);
            this.client = null;
            this.adapter.log.info('Disconnected from external MQTT broker');
        }
    }
}

module.exports = MQTTClient;
