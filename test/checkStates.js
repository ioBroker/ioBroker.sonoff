/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const { findShortenedStates } = require('../build/lib/checkStates');

function createAdapter(objects) {
    return {
        namespace: 'sonoff.0',
        getForeignObjectsAsync: async () => objects,
    };
}

function state(id, common) {
    return [id, { _id: id, type: 'state', common, native: {} }];
}

describe('Check of the state names (#489)', () => {
    it('finds a state which was created with a shortened name', async () => {
        const objects = Object.fromEntries([
            // created by 3.3.x from the data point "Total_in" in the group "SML"
            state('sonoff.0.meter.SML_in', {
                name: 'in',
                type: 'number',
                role: 'value.power.consumption',
                read: true,
                write: false,
                unit: 'kWh',
            }),
        ]);

        const found = await findShortenedStates(createAdapter(objects));
        assert.deepStrictEqual(found, [{ id: 'sonoff.0.meter.SML_in', expected: 'sonoff.0.meter.SML_Total_in' }]);
    });

    it('reports the shortened state if the corrected one exists too', async () => {
        const objects = Object.fromEntries([
            state('sonoff.0.meter.SML_out', {
                name: 'out',
                type: 'number',
                role: 'value.power.produced',
                read: true,
                write: false,
                unit: 'kWh',
            }),
            state('sonoff.0.meter.SML_Total_out', {
                name: 'Total_out',
                type: 'number',
                role: 'value.power.produced',
                read: true,
                write: false,
                unit: 'kWh',
            }),
        ]);

        const found = await findShortenedStates(createAdapter(objects));
        assert.deepStrictEqual(found.map(f => f.id), ['sonoff.0.meter.SML_out']);
    });

    it('does not report correct states', async () => {
        const objects = Object.fromEntries([
            // the path is part of the key of the data point, so it is removed correctly
            state('sonoff.0.meter.VEML6075_UvIndex', {
                name: 'UvIndex',
                type: 'number',
                role: 'value.uv',
                read: true,
                write: false,
            }),
            // the data point "Volt" in the group "SML"
            state('sonoff.0.meter.SML_Volt', {
                name: 'Volt',
                type: 'number',
                role: 'value.voltage',
                read: true,
                write: false,
                unit: 'V',
            }),
            // automatically created state of a device, not a known data point
            state('sonoff.0.meter.SML_POWER_curr', {
                name: 'POWER_curr',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            }),
            // no group at all
            state('sonoff.0.meter.alive', {
                name: 'alive',
                type: 'boolean',
                role: 'indicator.reachable',
                read: true,
                write: false,
            }),
        ]);

        const found = await findShortenedStates(createAdapter(objects));
        assert.deepStrictEqual(found, []);
    });
});
