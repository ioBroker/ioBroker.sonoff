"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SonoffAdapter = void 0;
/**
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017-2026 bluefox
 *
 *      MIT License
 */
const adapter_core_1 = require("@iobroker/adapter-core"); // Get common this utils
const server_1 = __importDefault(require("./lib/server"));
const bridge_1 = __importDefault(require("./lib/bridge"));
const checkStates_1 = require("./lib/checkStates");
const deviceManager_1 = __importDefault(require("./lib/deviceManager"));
const firmware_1 = require("./lib/firmware");
/** How many shortened states are written into the log */
const MAX_REPORTED_STATES = 20;
/** How often the latest Tasmota release is read from GitHub */
const FIRMWARE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
class SonoffAdapter extends adapter_core_1.Adapter {
    server = null;
    deviceManagement = null;
    /** Stops watching the credential from the central storage */
    unsubscribeCredentials = null;
    constructor(options = {}) {
        super({
            ...options,
            name: 'sonoff',
            ready: () => this.main(),
            unload: async (cb) => {
                if (this.unsubscribeCredentials) {
                    await this.unsubscribeCredentials().catch(() => { });
                    this.unsubscribeCredentials = null;
                }
                if (this.server) {
                    await this.server.destroy();
                    this.server = null;
                }
                if (typeof cb === 'function') {
                    cb();
                }
            },
            objectChange: (id, obj) => {
                // The credential from the central storage is handled by its own listener
                if (!id.startsWith(`${this.namespace}.`)) {
                    return;
                }
                this.deviceManagement?.onObjectChange(id, obj);
            },
            stateChange: (id, state) => {
                this.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
                this.deviceManagement?.onStateChange(id, state ?? null);
                // you can use the ack flag to detect if state is desired or acknowledged
                if (state && !state.ack) {
                    this.server
                        ?.onStateChange(id, state)
                        .catch(err => this.log.error(`Cannot process state change: ${err.message}`));
                }
            },
        });
    }
    async main() {
        this.deviceManagement = new deviceManager_1.default(this);
        // subscribe for all own variables
        this.subscribeStates('*');
        // read all states and set alive to false
        const states = await this.getStatesOfAsync('', '');
        if (states?.length) {
            for (const state of states) {
                if (state._id.match(/\.alive$/)) {
                    await this.setForeignStateAsync(state._id, false, true);
                }
            }
        }
        await this.reportShortenedStates();
        if (this.config.useExternalBroker && this.config.externalBrokerUrl) {
            if (await this.applyCredentials(true)) {
                this.server = new bridge_1.default(this);
            }
        }
        else {
            if (this.config.useExternalBroker) {
                this.log.warn('No external broker URL configured. Starting the built-in MQTT server');
            }
            if (await this.applyCredentials(false)) {
                this.server = new server_1.default(this);
            }
        }
        if (this.config.checkFirmware !== false) {
            await this.checkFirmware();
            // Managed by the adapter, so it is stopped on unload
            this.setInterval(() => void this.checkFirmware(), FIRMWARE_CHECK_INTERVAL);
        }
    }
    /**
     * If the user selected a credential from the central storage (Settings → Credentials) instead of
     * entering the login, reads it and writes login and password into the configuration, so the server,
     * the bridge and the device manager use them. The adapter restarts if the credential is changed.
     *
     * @param externalBroker true for the credentials of the external broker, false for the built-in server
     * @returns false if the credential cannot be read, so the MQTT server must not be started
     */
    async applyCredentials(externalBroker) {
        const type = externalBroker ? this.config.externalBrokerCredentialType : this.config.credentialType;
        if (type !== 'manager') {
            return true;
        }
        const id = externalBroker ? this.config.externalBrokerCredentialId : this.config.credentialId;
        if (!id) {
            this.log.error('No credential selected in the configuration. Please select one or enter the login manually');
            return false;
        }
        try {
            const credentials = await adapter_core_1.Credentials.getCredentials(this, id);
            if (adapter_core_1.Credentials.getCredentialForm(credentials.values) !== 'login') {
                this.log.error(`Credential "${id}" has no login and password. Please select another one`);
                return false;
            }
            if (externalBroker) {
                this.config.externalBrokerUser = credentials.values.login || '';
                this.config.externalBrokerPassword = credentials.values.password || '';
            }
            else {
                this.config.user = credentials.values.login || '';
                this.config.password = credentials.values.password || '';
            }
            this.log.info(`Using login "${credentials.values.login}" from credential "${id}"`);
        }
        catch (err) {
            this.log.error(`Cannot read credential "${id}": ${err.message}`);
            return false;
        }
        try {
            this.unsubscribeCredentials = await adapter_core_1.Credentials.subscribeCredentials(this, id, (changedId, credentials) => {
                if (credentials) {
                    this.log.info(`Credential "${changedId}" was changed. Restarting the adapter`);
                }
                else {
                    this.log.warn(`Credential "${changedId}" was deleted. Restarting the adapter`);
                }
                this.restart();
            });
        }
        catch (err) {
            this.log.warn(`Cannot watch credential "${id}" for changes: ${err.message}`);
        }
        return true;
    }
    /** Reads the latest Tasmota release, so the device manager can offer the firmware update */
    async checkFirmware() {
        try {
            const version = await (0, firmware_1.fetchLatestTasmotaVersion)();
            this.log.debug(`Latest Tasmota firmware: ${version}`);
            this.deviceManagement?.setLatestFirmware(version);
        }
        catch (err) {
            // Not important enough for a warning: without internet, there is simply no update indicator
            this.log.info(`Cannot check the latest Tasmota firmware: ${err.message}`);
        }
    }
    /**
     * The versions 3.3.x created states inside a group with a shortened name (issue #489),
     * e.g. "SML_in" instead of "SML_Total_in". They are not updated anymore, so the user is
     * informed about them. They are not deleted, because they can contain the history.
     */
    async reportShortenedStates() {
        try {
            const states = await (0, checkStates_1.findShortenedStates)(this);
            if (!states.length) {
                return;
            }
            this.log.warn(`${states.length} state(s) were created with a shortened name by the versions 3.3.x and are not updated anymore. Check them and delete them if they are not required:`);
            for (const state of states.slice(0, MAX_REPORTED_STATES)) {
                this.log.warn(`  ${state.id} => is now ${state.expected}`);
            }
            if (states.length > MAX_REPORTED_STATES) {
                this.log.warn(`  ... and ${states.length - MAX_REPORTED_STATES} more`);
            }
        }
        catch (err) {
            this.log.debug(`Cannot check the names of the states: ${err.message}`);
        }
    }
}
exports.SonoffAdapter = SonoffAdapter;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new SonoffAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new SonoffAdapter())();
}
//# sourceMappingURL=main.js.map