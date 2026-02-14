export interface SonoffAdapterConfig {
    // Mode selection
    mode: 'server' | 'client';

    // Server mode (built-in MQTT broker)
    port: number | string;
    bind: string;
    user: string;
    password: string;
    serverSsl: boolean;
    serverCertPath: string;
    serverKeyPath: string;

    // Client mode (external MQTT broker)
    brokerUrl: string;
    brokerPort: number | string;
    brokerUser: string;
    brokerPassword: string;
    brokerClientId: string;
    brokerTopicPrefix: string;
    brokerTopicStructure: 'standard' | 'device-first';
    brokerUseTls: boolean;
    brokerTlsRejectUnauthorized: boolean;
    brokerCaPath: string;
    brokerCertPath: string;
    brokerKeyPath: string;
    brokerKeepalive: number | string;
    brokerReconnectPeriod: number | string;
    brokerCleanSession: boolean;

    // Options
    timeout: number | string;
    TELE_SENSOR: boolean;
    TELE_MARGINS: boolean;
    TELE_STATE: boolean;
    STAT_RESULT: boolean;
    OBJ_TREE: boolean;

    // Advanced server settings (used by server.ts)
    storeClientsTime: number | string;
    defaultQoS: 0 | 1 | 2;
    retransmitInterval: number;
    retransmitCount: number;
    ignorePings: boolean;
    ignoreNotConnectedWarnings: boolean;
    sendInterval: number;
}
