/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

const assert = require('node:assert');
const { isNewerVersion, parseVersion } = require('../build/lib/firmware');

describe('Tasmota firmware version', () => {
    it('reads the version with and without build variant', () => {
        assert.deepStrictEqual(parseVersion('14.2.0(tasmota)'), [14, 2, 0, 0]);
        assert.deepStrictEqual(parseVersion('15.0.1(release-tasmota32)'), [15, 0, 1, 0]);
        assert.deepStrictEqual(parseVersion('15.0.1.3(tasmota)'), [15, 0, 1, 3]);
        assert.deepStrictEqual(parseVersion('v15.0.1'), [15, 0, 1, 0]);
        assert.strictEqual(parseVersion('OpenBK7231T 1.17'), null);
        assert.strictEqual(parseVersion(undefined), null);
    });

    it('offers only a newer release', () => {
        assert.strictEqual(isNewerVersion('15.0.1', '14.2.0(tasmota)'), true);
        assert.strictEqual(isNewerVersion('15.0.1', '15.0.0(tasmota)'), true);
        assert.strictEqual(isNewerVersion('15.0.1', '15.0.1(tasmota)'), false);
        assert.strictEqual(isNewerVersion('15.0.1', '15.1.0(tasmota)'), false);
        // a development build is newer than the release it is based on
        assert.strictEqual(isNewerVersion('15.0.1', '15.0.1.2(tasmota)'), false);
        // unknown versions are never updated
        assert.strictEqual(isNewerVersion(null, '14.2.0(tasmota)'), false);
        assert.strictEqual(isNewerVersion('15.0.1', 'unknown'), false);
    });
});
