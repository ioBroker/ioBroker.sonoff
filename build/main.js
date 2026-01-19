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
        this.server = new server_1.default(this);
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