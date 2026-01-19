/**
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017-2026 bluefox
 *
 *      MIT License
 */
import { Adapter, type AdapterOptions } from '@iobroker/adapter-core'; // Get common this utils
import Server from './lib/server';
import type { SonoffAdapterConfig } from './types';

export class SonoffAdapter extends Adapter {
    declare config: SonoffAdapterConfig;
    server: Server | null = null;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'sonoff',
            ready: () => this.main(),
            unload: async (cb?: () => void): Promise<void> => {
                if (this.server) {
                    await this.server.destroy();
                    this.server = null;
                }
                if (typeof cb === 'function') {
                    cb();
                }
            },
            stateChange: (id: string, state: ioBroker.State | null | undefined): void => {
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

    private async main(): Promise<void> {
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

        this.server = new Server(this as ioBroker.Adapter);
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new SonoffAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new SonoffAdapter())();
}
