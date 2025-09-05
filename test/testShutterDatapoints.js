/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const expect = require('chai').expect;
const datapoints = require('../lib/datapoints');

describe('SHUTTER Datapoints', () => {
    it('should have all SHUTTER1-SHUTTER16 datapoints defined', () => {
        for (let i = 1; i <= 16; i++) {
            const shutterKey = `SHUTTER${i}`;
            expect(datapoints).to.have.property(shutterKey);
            
            const shutterDef = datapoints[shutterKey];
            expect(shutterDef).to.be.an('object', `${shutterKey} should be an object`);
            expect(shutterDef.type).to.equal('number', `${shutterKey} should have type 'number'`);
            expect(shutterDef.role).to.equal('state', `${shutterKey} should have role 'state'`);
            expect(shutterDef.read).to.equal(true, `${shutterKey} should be readable`);
            expect(shutterDef.write).to.equal(false, `${shutterKey} should not be writable`);
        }
    });

    it('should have the correct structure for all SHUTTER datapoints', () => {
        const expectedStructure = {
            type: 'number',
            role: 'state',
            read: true,
            write: false
        };

        for (let i = 1; i <= 16; i++) {
            const shutterKey = `SHUTTER${i}`;
            expect(datapoints[shutterKey]).to.deep.equal(expectedStructure, `${shutterKey} should match expected structure`);
        }
    });

    it('should export the datapoints module correctly', () => {
        expect(datapoints).to.be.an('object');
        expect(Object.keys(datapoints).length).to.be.greaterThan(100, 'Should have many datapoints defined');
    });
});