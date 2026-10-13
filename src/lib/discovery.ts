import { networkInterfaces } from 'node:os';

/** How long one address may take to answer during the scan */
const PROBE_TIMEOUT = 2000;
/** How many addresses are asked at the same time */
const SCAN_CONCURRENCY = 64;

/** A Tasmota device found in the network */
export interface TasmotaDevice {
    ip: string;
    /** The device has a web password, so nothing but its existence is known */
    protected: boolean;
    name?: string;
    hostname?: string;
    mac?: string;
    version?: string;
    /** Topic of the device, e.g. "tasmota_ABCDEF" */
    topic?: string;
    mqttHost?: string;
    mqttPort?: number;
    mqttUser?: string;
    /** MQTT client ID, e.g. "DVES_ABCDEF" - the adapter names the device after it */
    mqttClient?: string;
    /** SetOption3: MQTT enabled */
    mqttEnabled?: boolean;
}

/** MQTT settings written to a device */
export interface MqttSettings {
    host: string;
    port: number;
    user: string;
    password: string;
}

/** The device answered, but requires its web password */
export class TasmotaAuthError extends Error {
    constructor(ip: string) {
        super(`${ip} requires the web password`);
    }
}

interface StatusAnswer {
    Status?: { DeviceName?: string; FriendlyName?: string[]; Topic?: string };
    StatusFWR?: { Version?: string };
    StatusNET?: { Hostname?: string; Mac?: string };
    StatusMQT?: { MqttHost?: string; MqttPort?: number; MqttUser?: string; MqttClient?: string };
}

/**
 * Sends one command to the web interface of a Tasmota device.
 *
 * @param ip address of the device
 * @param command Tasmota command, e.g. "Status 0"
 * @param password web password, if the device has one (the user is always "admin")
 * @param timeout how long to wait for the answer
 * @returns the parsed answer
 */
export async function sendHttpCommand(
    ip: string,
    command: string,
    password?: string,
    timeout = PROBE_TIMEOUT,
): Promise<Record<string, unknown>> {
    const auth = password ? `user=admin&password=${encodeURIComponent(password)}&` : '';
    const response = await fetch(`http://${ip}/cm?${auth}cmnd=${encodeURIComponent(command)}`, {
        signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    // A device with a web password answers 401 with {"WARNING":"Need user=<username>&password=<password>"}.
    // Only this text is checked: other devices (e.g. Shelly) answer 401 to any request, too.
    if (text.includes('Need user=')) {
        throw new TasmotaAuthError(ip);
    }
    if (!response.ok) {
        throw new Error(`${ip} answered with ${response.status}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Asks one address whether it is a Tasmota device.
 *
 * @param ip address to ask
 * @param password web password, if known
 * @returns the device or null if there is no Tasmota device at this address
 */
export async function probeDevice(ip: string, password?: string): Promise<TasmotaDevice | null> {
    let status: StatusAnswer;
    try {
        status = await sendHttpCommand(ip, 'Status 0', password);
    } catch (err) {
        return err instanceof TasmotaAuthError ? { ip, protected: true } : null;
    }
    if (!status.Status || !status.StatusFWR) {
        // Some other device with a web server
        return null;
    }

    const device: TasmotaDevice = {
        ip,
        protected: false,
        name: status.Status.DeviceName || status.Status.FriendlyName?.[0],
        hostname: status.StatusNET?.Hostname,
        mac: status.StatusNET?.Mac,
        version: status.StatusFWR.Version,
        topic: status.Status.Topic,
        mqttHost: status.StatusMQT?.MqttHost,
        mqttPort: status.StatusMQT?.MqttPort,
        mqttUser: status.StatusMQT?.MqttUser,
        mqttClient: status.StatusMQT?.MqttClient,
    };
    try {
        const option = await sendHttpCommand(ip, 'SetOption3', password);
        device.mqttEnabled = option.SetOption3 === 'ON';
    } catch {
        // not important, only shown to the user
    }
    return device;
}

/**
 * All addresses of the local networks, except the own ones. Only the /24 network around each own address
 * is scanned - a bigger network would take too long.
 */
export function getScanAddresses(): string[] {
    const own = new Set<string>();
    const networks = new Set<string>();
    for (const list of Object.values(networkInterfaces())) {
        for (const iface of list || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                own.add(iface.address);
                const [a, b] = iface.address.split('.').map(n => parseInt(n, 10));
                // 100.64.0.0/10 is used by VPNs like Tailscale, there are no Tasmota devices
                if (a !== 100 || b < 64 || b > 127) {
                    networks.add(iface.address.split('.').slice(0, 3).join('.'));
                }
            }
        }
    }
    const addresses: string[] = [];
    for (const network of networks) {
        for (let i = 1; i < 255; i++) {
            const ip = `${network}.${i}`;
            if (!own.has(ip)) {
                addresses.push(ip);
            }
        }
    }
    return addresses;
}

/**
 * Searches for Tasmota devices by asking every address for its status.
 *
 * Tasmota announces itself by mDNS only if it was built with it, which the official builds are not,
 * so the addresses are asked one by one via the web interface.
 *
 * @param onProgress called after every address with the number of asked addresses
 * @param addresses addresses to ask, by default the local networks
 */
export async function scanNetwork(
    onProgress?: (done: number, total: number) => void,
    addresses: string[] = getScanAddresses(),
): Promise<TasmotaDevice[]> {
    const found: TasmotaDevice[] = [];
    let next = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
        while (next < addresses.length) {
            const ip = addresses[next++];
            const device = await probeDevice(ip);
            if (device) {
                found.push(device);
            }
            onProgress?.(++done, addresses.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, addresses.length) }, () => worker()));
    return found.sort((a, b) => ipToNumber(a.ip) - ipToNumber(b.ip));
}

function ipToNumber(ip: string): number {
    return ip.split('.').reduce((sum, part) => sum * 256 + parseInt(part, 10), 0);
}

/**
 * The Backlog command which enables MQTT and connects the device with the broker. Tasmota clears the user
 * and the password with "0". The device restarts by itself after the MQTT settings are changed.
 *
 * @param settings MQTT settings
 */
export function buildMqttCommand(settings: MqttSettings): string {
    for (const value of [settings.host, settings.user, settings.password]) {
        // ";" separates the commands of a Backlog
        if (value.includes(';')) {
            throw new Error('";" is not allowed in the MQTT settings');
        }
    }
    return [
        'Backlog SetOption3 1',
        `MqttHost ${settings.host}`,
        `MqttPort ${settings.port}`,
        `MqttUser ${settings.user || '0'}`,
        `MqttPassword ${settings.password || '0'}`,
    ].join('; ');
}

/**
 * Enables MQTT on a device and connects it with the broker.
 *
 * @param ip address of the device
 * @param settings MQTT settings
 * @param password web password of the device, if it has one
 */
export async function configureMqtt(ip: string, settings: MqttSettings, password?: string): Promise<void> {
    const answer = await sendHttpCommand(ip, buildMqttCommand(settings), password, 10000);
    if (typeof answer.WARNING === 'string') {
        throw new Error(answer.WARNING);
    }
    if (answer.Command === 'Unknown') {
        throw new Error('Unknown command');
    }
}

/**
 * The own address in the network of the device, which the device can reach.
 *
 * @param targetIp address of the device
 */
export function getLocalIp(targetIp: string): string | undefined {
    const network = `${targetIp.split('.').slice(0, 3).join('.')}.`;
    let fallback: string | undefined;
    for (const list of Object.values(networkInterfaces())) {
        for (const iface of list || []) {
            if (iface.family !== 'IPv4' || iface.internal) {
                continue;
            }
            if (iface.address.startsWith(network)) {
                return iface.address;
            }
            fallback ||= iface.address;
        }
    }
    return fallback;
}
