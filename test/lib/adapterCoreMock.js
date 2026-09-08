/* jshint -W097 */
/* jshint strict: true */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';

// ------------------------------------------------------------------------
// Requiring "@iobroker/adapter-core" looks for an installed js-controller and
// kills the process with exit code 10 if there is none - which there is not in
// a unit test. The adapter code only uses "I18n" from it, and that part works
// standalone, so hand out a module that has just this one export.
// ------------------------------------------------------------------------
const path = require('node:path');

// Resolving the entry point does not execute it, so this is safe
const corePath = require.resolve('@iobroker/adapter-core');
const i18nPath = path.join(path.dirname(corePath), 'i18n.js');

if (!require.cache[corePath]) {
    require.cache[corePath] = {
        id: corePath,
        filename: corePath,
        loaded: true,
        exports: { I18n: require(i18nPath) },
    };
}

module.exports = { I18n: require.cache[corePath].exports.I18n };
