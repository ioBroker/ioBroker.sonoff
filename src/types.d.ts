export interface SonoffAdapterConfig {
    port: number | string;
    bind: string;
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
    sendInterval: number;
}
