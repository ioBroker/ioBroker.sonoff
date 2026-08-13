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
/** How many shortened states are written into the log */
const MAX_REPORTED_STATES = 20;
class SonoffAdapter extends adapter_core_1.Adapter {
    server = null;
    constructor(options = {}) {
        super({
            ...options,
            name: 'sonoff',
            ready: () => this.main(),
            unload: async (cb) => {
                if (this.server) {
                    await this.server.destroy();
                    this.server = null;
                }
                if (typeof cb === 'function') {
                    cb();
                }
            },
            stateChange: (id, state) => {
                this.log.debug(`stateChange ${id}: ${JSON.stringify(state)}`);
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
            this.server = new bridge_1.default(this);
        }
        else {
            if (this.config.useExternalBroker) {
                this.log.warn('No external broker URL configured. Starting the built-in MQTT server');
            }
            this.server = new server_1.default(this);
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