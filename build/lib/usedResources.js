"use strict";
/**
 * Reports the TCP port of the built-in MQTT server to js-controller (from 8.0 on), which shows the occupied
 * ports of all instances in `system.host.<host>.usedResources.tcpPort`, so the user can pick a free one.
 *
 * The adapter declares its resources itself (`common.declareUsedResources: true`): otherwise js-controller
 * would list `native.port` as occupied, also in the bridge mode, in which the adapter only connects to an
 * external broker and occupies no port at all.
 *
 * Older js-controllers do not have these functions, then nothing is reported.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTcpPort = registerTcpPort;
exports.findPortHolders = findPortHolders;
function toTcpPortData(port, bind) {
    const data = { port };
    if (bind?.trim()) {
        data.bind = bind.trim();
    }
    return data;
}
/**
 * Registers the port the MQTT server listens on as used by this instance.
 *
 * @param adapter the adapter instance
 * @param port the port the server listens on
 * @param bind the address the server is bound to
 * @returns true if the port was registered, false if js-controller does not support it
 */
async function registerTcpPort(adapter, port, bind) {
    const resourceAdapter = adapter;
    if (typeof resourceAdapter.registerUsedResource !== 'function') {
        return false;
    }
    try {
        await resourceAdapter.registerUsedResource.call(adapter, 'tcpPort', toTcpPortData(port, bind));
        return true;
    }
    catch (err) {
        // only an overview for the user, the server works without it
        adapter.log.warn(`Cannot report the used port ${port} to js-controller: ${err.message}`);
        return false;
    }
}
/**
 * The other instances on this host, which have registered the port. Used to tell the user, which
 * instance occupies the port, if the server cannot start.
 *
 * @param adapter the adapter instance
 * @param port the port
 * @returns the instances, e.g. ["mqtt.0"], or an empty list if unknown
 */
async function findPortHolders(adapter, port) {
    const resourceAdapter = adapter;
    if (typeof resourceAdapter.checkUsedResource !== 'function') {
        return [];
    }
    try {
        // only the port: whatever address the other instance is bound to, it got the port first
        const holders = await resourceAdapter.checkUsedResource.call(adapter, 'tcpPort', { port });
        return [...new Set(holders.map(holder => holder.instance))].filter(instance => instance !== adapter.namespace);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=usedResources.js.map