/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
require('./lib/adapterCoreMock');
const { setup } = require('./lib/mqttMock');
const SonoffDeviceManagement = require('../build/lib/deviceManager').default;

const DEVICE = 'sonoff.0.DVES_123456';

/** Feeds one Tasmota device into the adapter and returns its device manager entry */
async function loadDevice(configOverrides, messages) {
    const { adapter, bridge, send } = setup(configOverrides);

    // STATUS6 carries the MQTT client ID, that is what the device channel is named after
    await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
    for (const [topic, payload] of messages) {
        await send(topic, payload);
    }

    const dm = new SonoffDeviceManagement(adapter);
    const devices = [];
    await dm.loadDevices({ addDevice: device => devices.push(device), setTotalDevices: () => {} });

    return { adapter, bridge, dm, devices, send };
}

/** Reduces the controls to what they mean, so two runs can be compared */
const shape = controls =>
    controls
        .map(control => `${control.type} ${control.id} -> ${control.stateId || ''}`)
        .sort()
        .join('\n');

describe('Device manager', function () {
    this.timeout(10000);

    // The controls of a device are found by data point name. "Create object tree" only moves those
    // data points into a folder per topic group, it does not change which of them a device has
    it('builds the same controls with and without "Create object tree"', async () => {
        const messages = [
            ['stat/kitchen/RESULT', '{"Dimmer":50,"CT":300,"Color":"FF0000","Shutter1":{"Position":30}}'],
            ['tele/kitchen/STATE', '{"Time":"2026-08-26T12:00:00","POWER1":"ON","Wifi":{"RSSI":70}}'],
        ];

        const flat = await loadDevice({ OBJ_TREE: false }, messages);
        const tree = await loadDevice({ OBJ_TREE: true }, messages);

        const flatControls = flat.devices[0].controls;
        assert.strictEqual(shape(flatControls).length > 0, true, 'the flat device must have controls');

        // Same controls, but pointing at the nested state IDs
        assert.deepStrictEqual(
            tree.devices[0].controls.map(c => `${c.type} ${c.id}`).sort(),
            flatControls.map(c => `${c.type} ${c.id}`).sort(),
        );

        const byId = controls => Object.fromEntries(controls.map(c => [c.id, c]));
        const treeById = byId(tree.devices[0].controls);
        assert.strictEqual(treeById.Dimmer.type, 'slider');
        assert.strictEqual(treeById.Dimmer.stateId, 'DVES_123456.RESULT.Dimmer');
        assert.strictEqual(byId(flatControls).Dimmer.stateId, 'DVES_123456.Dimmer');
        assert.strictEqual(treeById.CT.type, 'slider');
        assert.strictEqual(treeById.Color.type, 'color');
        assert.strictEqual(treeById.Shutter1_Position.type, 'slider');
        assert.strictEqual(treeById.POWER1.type, 'switch');

        await flat.bridge.destroy();
        await tree.bridge.destroy();
    });

    it('puts a device in the same group with and without "Create object tree"', async () => {
        const messages = [['stat/kitchen/RESULT', '{"Dimmer":50}']];

        const flat = await loadDevice({ OBJ_TREE: false }, messages);
        const tree = await loadDevice({ OBJ_TREE: true }, messages);

        assert.strictEqual(flat.devices[0].group.key, 'light');
        assert.strictEqual(tree.devices[0].group.key, 'light');

        await flat.bridge.destroy();
        await tree.bridge.destroy();
    });

    // Tasmota reports a reading with the name of the sensor in front of it, e.g. "AM2301_Temperature",
    // so the plain data point name is never the whole state ID
    it('recognizes a sensor device by the readings its sensor reports', async () => {
        const messages = [
            ['tele/kitchen/SENSOR', '{"Time":"2026-08-26T12:00:00","AM2301":{"Temperature":21.6,"Humidity":54.7}}'],
        ];

        const flat = await loadDevice({ OBJ_TREE: false }, messages);
        const tree = await loadDevice({ OBJ_TREE: true }, messages);

        assert.strictEqual(flat.devices[0].group.key, 'sensor');
        assert.strictEqual(tree.devices[0].group.key, 'sensor');

        await flat.bridge.destroy();
        await tree.bridge.destroy();
    });

    it('shows a power reading only once, even if it exists nested and bare', async () => {
        const { adapter, bridge, dm } = await loadDevice({ OBJ_TREE: true }, [
            ['tele/kitchen/SENSOR', '{"Time":"2026-08-26T12:00:00","ENERGY":{"Power":12,"Voltage":231}}'],
        ]);

        // A leftover from before "Create object tree" was switched on
        adapter.objects[`${DEVICE}.ENERGY.Power`] = {
            _id: `${DEVICE}.ENERGY.Power`,
            type: 'state',
            common: { type: 'number', role: 'value', read: true, write: false, name: 'Power' },
            native: {},
        };
        adapter.states[`${DEVICE}.ENERGY.Power`] = { val: 99, ack: true, ts: 42 };
        dm.onObjectChange(`${DEVICE}.ENERGY.Power`, adapter.objects[`${DEVICE}.ENERGY.Power`]);
        dm.onStateChange(`${DEVICE}.ENERGY.Power`, adapter.states[`${DEVICE}.ENERGY.Power`]);

        const details = await dm.getDeviceDetails(DEVICE);
        const powerItems = Object.keys(details.schema.items).filter(key => key.startsWith('energy_'));
        assert.deepStrictEqual(powerItems.sort(), ['energy_SENSOR_ENERGY_Power', 'energy_SENSOR_ENERGY_Voltage']);

        await bridge.destroy();
    });

    // The server/bridge creates every object only once per adapter run, so deleting the data points
    // is only half the job - the cache has to be dropped as well, see MQTTBase.forgetObjects
    it('recreates the deleted data points without a restart of the adapter', async () => {
        const telemetry = ['tele/kitchen/STATE', '{"Time":"2026-08-26T12:00:00","POWER1":"ON"}'];
        const { adapter, bridge, dm, send } = await loadDevice({ OBJ_TREE: false }, [telemetry]);

        assert.ok(adapter.objects[`${DEVICE}.POWER1`], 'the data point must exist before the reset');

        await dm.handleRecreateDevice(DEVICE, {});

        assert.ok(!adapter.objects[`${DEVICE}.POWER1`], 'the data point must be deleted');
        assert.ok(adapter.objects[DEVICE], 'the device itself (and its name) must be kept');
        assert.ok(adapter.objects[`${DEVICE}.alive`], 'alive is written by the adapter, not by the device');

        await send(...telemetry);

        assert.ok(adapter.objects[`${DEVICE}.POWER1`], 'the data point must be recreated by the next message');
        assert.strictEqual(adapter.states[`${DEVICE}.POWER1`].val, true);

        await bridge.destroy();
    });

    // A data point without "common" can be left behind by a much older adapter version or a manual
    // edit. It must not take down the whole device list - only the device manager entry is affected.
    it('still lists devices when one data point object has no "common"', async () => {
        const { adapter, bridge, send } = setup({ OBJ_TREE: false });

        await send('stat/kitchen/STATUS6', '{"StatusMQT":{"MqttClient":"DVES_123456"}}');
        await send('tele/kitchen/STATE', '{"Time":"2026-08-26T12:00:00","POWER1":"ON"}');

        adapter.objects[`${DEVICE}.LegacyLeftover`] = {
            _id: `${DEVICE}.LegacyLeftover`,
            type: 'state',
            native: {},
        };

        const dm = new SonoffDeviceManagement(adapter);
        const devices = [];
        await dm.loadDevices({ addDevice: device => devices.push(device), setTotalDevices: () => {} });

        assert.strictEqual(devices.length, 1, 'the device must still be reported');

        await bridge.destroy();
    });
});
