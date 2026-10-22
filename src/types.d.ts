export interface SonoffAdapterConfig {
    port: number | string;
    bind: string;
    /** Where the credentials of the built-in server come from: from user/password or from the central credential storage */
    credentialType?: 'manual' | 'manager';
    /** ID of the credential in the central storage, e.g. system.credentials.mqtt */
    credentialId?: string;
    user: string;
    password: string;
    timeout: number | string;
    TELE_SENSOR: boolean;
    TELE_MARGINS: boolean;
    TELE_STATE: boolean;
    STAT_RESULT: boolean;
    OBJ_TREE: boolean;
    storeClientsTime: number | string;
    defaultQoS: 0 | 1 | 2;
    retransmitInterval: number;
    retransmitCount: number;
    ignorePings: boolean;
    ignoreNotConnectedWarnings: boolean;
    /** Read the latest Tasmota release from GitHub to offer the firmware update in the device manager */
    checkFirmware: boolean;
    sendInterval: number;
    useExternalBroker: boolean;
    externalBrokerUrl: string;
    /** Where the credentials of the external broker come from: from externalBrokerUser/externalBrokerPassword or from the central credential storage */
    externalBrokerCredentialType?: 'manual' | 'manager';
    /** ID of the credential in the central storage, e.g. system.credentials.mqtt */
    externalBrokerCredentialId?: string;
    externalBrokerUser: string;
    externalBrokerPassword: string;
    externalBrokerTopics: string;
    externalBrokerClientId: string;
    externalBrokerKeepalive: number | string;
    externalBrokerCleanSession: boolean;
    externalBrokerRejectUnauthorized: boolean;
    externalBrokerCaPath: string;
    externalBrokerCertPath: string;
    externalBrokerKeyPath: string;
}
