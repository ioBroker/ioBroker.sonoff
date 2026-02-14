import * as mqtt from 'mqtt';
import fs from 'node:fs';

export interface MQTTClientOptions {
    url: string;
    user: string;
    password: string;
    clientId: string;
    useTls: boolean;
    rejectUnauthorized: boolean;
    caPath: string;
    certPath: string;
    keyPath: string;
    topicPrefix: string;
    keepalive: number;
    reconnectPeriod: number;
    cleanSession: boolean;
}

export default class MQTTClientWrapper {
    private client: mqtt.MqttClient | null = null;
    private _connected = false;
    private readonly adapter: ioBroker.Adapter;
    private readonly options: MQTTClientOptions;
    private readonly knownDevices = new Set<string>();

    onMessage?: (topic: string, message: string, deviceId: string) => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (error: Error) => void;
    onDeviceOnline?: (deviceId: string) => void;

    constructor(adapter: ioBroker.Adapter, options: MQTTClientOptions) {
        this.adapter = adapter;
        this.options = options;
    }

    get connected(): boolean {
        return this._connected;
    }

    async connect(): Promise<void> {
        const connectOptions: mqtt.IClientOptions = {
            clientId: this.options.clientId,
            keepalive: this.options.keepalive || 60,
            reconnectPeriod: this.options.reconnectPeriod || 5000,
            clean: this.options.cleanSession !== false,
            protocolVersion: 4,
        };

        if (this.options.user) {
            connectOptions.username = this.options.user;
            connectOptions.password = this.options.password || '';
        }

        if (this.options.useTls) {
            connectOptions.rejectUnauthorized = this.options.rejectUnauthorized !== false;

            if (this.options.caPath) {
                try {
                    connectOptions.ca = fs.readFileSync(this.options.caPath);
                    this.adapter.log.debug('CA certificate loaded');
                } catch (err: any) {
                    this.adapter.log.warn(`Cannot read CA certificate: ${err.message}`);
                }
            }

            if (this.options.certPath) {
                try {
                    connectOptions.cert = fs.readFileSync(this.options.certPath);
                    this.adapter.log.debug('Client certificate loaded');
                } catch (err: any) {
                    this.adapter.log.warn(`Cannot read client certificate: ${err.message}`);
                }
            }

            if (this.options.keyPath) {
                try {
                    connectOptions.key = fs.readFileSync(this.options.keyPath);
                    this.adapter.log.debug('Client key loaded');
                } catch (err: any) {
                    this.adapter.log.warn(`Cannot read client key: ${err.message}`);
                }
            }
        }

        return new Promise<void>(resolve => {
            this.adapter.log.info(`Connecting to MQTT broker: ${this.options.url}`);

            this.client = mqtt.connect(this.options.url, connectOptions);

            this.client.on('connect', () => {
                this._connected = true;
                this.adapter.log.info('Successfully connected to external MQTT broker');
                this.onConnected?.();
                this.subscribeToTasmotaTopics();
                resolve();
            });

            this.client.on('message', (topic: string, message: Buffer) => {
                this.handleMessage(topic, message);
            });

            this.client.on('reconnect', () => {
                this.adapter.log.debug('Reconnecting to MQTT broker...');
            });

            this.client.on('close', () => {
                if (this._connected) {
                    this._connected = false;
                    this.onDisconnected?.();
                }
            });

            this.client.on('offline', () => {
                this._connected = false;
                this.adapter.log.debug('MQTT client offline');
            });

            this.client.on('error', (err: Error) => {
                this.adapter.log.error(`MQTT client error: ${err.message}`);
                this.onError?.(err);
            });

            // Don't block adapter startup on connection timeout
            setTimeout(() => {
                if (!this._connected) {
                    this.adapter.log.warn('Initial MQTT connection timeout - will keep trying to reconnect');
                    resolve();
                }
            }, 10000);
        });
    }

    private subscribeToTasmotaTopics(): void {
        const prefix = this.options.topicPrefix ? `${this.options.topicPrefix}/` : '';

        const topics = [
            `${prefix}tele/+/STATE`,
            `${prefix}tele/+/SENSOR`,
            `${prefix}tele/+/RESULT`,
            `${prefix}tele/+/LWT`,
            `${prefix}tele/+/INFO1`,
            `${prefix}tele/+/INFO2`,
            `${prefix}tele/+/INFO3`,
            `${prefix}tele/+/ENERGY`,
            `${prefix}tele/+/MARGINS`,
            `${prefix}tele/+/WAKEUP`,
            `${prefix}stat/+/RESULT`,
            `${prefix}stat/+/POWER`,
            `${prefix}stat/+/POWER1`,
            `${prefix}stat/+/POWER2`,
            `${prefix}stat/+/POWER3`,
            `${prefix}stat/+/POWER4`,
            `${prefix}stat/+/POWER5`,
            `${prefix}stat/+/POWER6`,
            `${prefix}stat/+/POWER7`,
            `${prefix}stat/+/POWER8`,
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
            // Wildcard fallback for any additional topics
            `${prefix}tele/+/+`,
            `${prefix}stat/+/+`,
        ];

        this.client?.subscribe(topics, { qos: 0 }, (err?: Error | null) => {
            if (err) {
                this.adapter.log.error(`Error subscribing to Tasmota topics: ${err.message}`);
            } else {
                this.adapter.log.info(
                    `Subscribed to Tasmota topics${this.options.topicPrefix ? ` with prefix "${this.options.topicPrefix}"` : ''}`,
                );
            }
        });
    }

    private handleMessage(topic: string, messageBuffer: Buffer): void {
        const message = messageBuffer.toString();
        const prefix = this.options.topicPrefix;

        let effectiveTopic = topic;
        if (prefix && topic.startsWith(`${prefix}/`)) {
            effectiveTopic = topic.substring(prefix.length + 1);
        }

        const parts = effectiveTopic.split('/');
        if (parts.length < 3) {
            return;
        }

        const deviceId = parts[1];

        if (!this.knownDevices.has(deviceId)) {
            this.knownDevices.add(deviceId);
            this.onDeviceOnline?.(deviceId);
        }

        // Handle LWT (Last Will and Testament)
        if (parts[0] === 'tele' && parts[2] === 'LWT') {
            if (message === 'Offline') {
                this.knownDevices.delete(deviceId);
            }
        }

        this.onMessage?.(effectiveTopic, message, deviceId);
    }

    publish(topic: string, payload: string, options?: mqtt.IClientPublishOptions): void {
        if (!this.client || !this._connected) {
            this.adapter.log.warn('Cannot publish - not connected to MQTT broker');
            return;
        }

        const prefix = this.options.topicPrefix;
        const fullTopic = prefix ? `${prefix}/${topic}` : topic;

        this.client.publish(fullTopic, payload, options || { qos: 0, retain: false }, (err?: Error) => {
            if (err) {
                this.adapter.log.error(`Error publishing to ${fullTopic}: ${err.message}`);
            } else {
                this.adapter.log.debug(`Published: ${fullTopic} = ${payload}`);
            }
        });
    }

    disconnect(): void {
        if (this.client) {
            this._connected = false;
            this.client.end(true);
            this.client = null;
            this.adapter.log.info('Disconnected from external MQTT broker');
        }
    }
}
