/**
 *      ioBroker sonoff Adapter
 *
 *      (c) 2017-2026 bluefox
 *
 *      MIT License
 */
import { Adapter, type AdapterOptions } from '@iobroker/adapter-core'; // Get common this utils
import MQTTServer from './lib/server';
import MQTTBridge from './lib/bridge';
import type MQTTBase from './lib/mqttBase';
import { findShortenedStates } from './lib/checkStates';
import type { SonoffAdapterConfig } from './types';

/** How many shortened states are written into the log */
const MAX_REPORTED_STATES = 20;

export class SonoffAdapter extends Adapter {
    declare config: SonoffAdapterConfig;
    server: MQTTBase | null = null;

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

        await this.reportShortenedStates();

        if (this.config.useExternalBroker && this.config.externalBrokerUrl) {
            this.server = new MQTTBridge(this);
        } else {
            if (this.config.useExternalBroker) {
                this.log.warn('No external broker URL configured. Starting the built-in MQTT server');
            }
            this.server = new MQTTServer(this);
        }
    }

    /**
     * The versions 3.3.x created states inside a group with a shortened name (issue #489),
     * e.g. "SML_in" instead of "SML_Total_in". They are not updated anymore, so the user is
     * informed about them. They are not deleted, because they can contain the history.
     */
    private async reportShortenedStates(): Promise<void> {
        try {
            const states = await findShortenedStates(this);
            if (!states.length) {
                return;
            }

            this.log.warn(
                `${states.length} state(s) were created with a shortened name by the versions 3.3.x and are not updated anymore. Check them and delete them if they are not required:`,
            );
            for (const state of states.slice(0, MAX_REPORTED_STATES)) {
                this.log.warn(`  ${state.id} => is now ${state.expected}`);
            }
            if (states.length > MAX_REPORTED_STATES) {
                this.log.warn(`  ... and ${states.length - MAX_REPORTED_STATES} more`);
            }
        } catch (err: unknown) {
            this.log.debug(`Cannot check the names of the states: ${(err as Error).message}`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new SonoffAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new SonoffAdapter())();
}
