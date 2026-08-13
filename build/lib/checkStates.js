"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findShortenedStates = findShortenedStates;
const datapoints_1 = __importDefault(require("./datapoints"));
/** Keys of the data points which contain "_", grouped by their last part */
function getKeysByLastPart() {
    const keys = {};
    for (const key of Object.keys(datapoints_1.default)) {
        const pos = key.lastIndexOf('_');
        if (pos > 0) {
            const lastPart = key.substring(pos + 1);
            keys[lastPart] ||= [];
            keys[lastPart].push(key);
        }
    }
    return keys;
}
/**
 * The versions 3.3.x created the states inside a group with a shortened name (issue #489):
 * only the last part of the key of the data point was used, so "SML_Total_in" was created
 * as "SML_in". Such states are not updated anymore after the correction.
 *
 * They are only reported and never deleted, because they can still contain the history of the user.
 */
async function findShortenedStates(adapter) {
    const keysByLastPart = getKeysByLastPart();
    const objects = await adapter.getForeignObjectsAsync(`${adapter.namespace}.*`, 'state');
    const found = [];
    for (const [id, obj] of Object.entries(objects)) {
        const dot = id.lastIndexOf('.');
        const name = id.substring(dot + 1);
        const underscore = name.lastIndexOf('_');
        if (underscore < 1) {
            continue;
        }
        const path = name.substring(0, underscore);
        const lastPart = name.substring(underscore + 1);
        // "SML_Volt" is simply the data point "Volt" in the group "SML"
        if (datapoints_1.default[lastPart]) {
            continue;
        }
        for (const key of keysByLastPart[lastPart] || []) {
            // "SML_Total_in" already contains the complete key of the data point
            if (name.endsWith(`_${key}`)) {
                continue;
            }
            // "VEML6075_UvIndex" in the group "VEML6075" is correct, the path is removed there
            if (key.startsWith(`${path}_`)) {
                continue;
            }
            const definition = datapoints_1.default[key];
            const common = obj.common;
            const expected = `${id.substring(0, dot)}.${path}_${key}`;
            // Either the state with the correct name exists already, or the state was created
            // from exactly this data point - otherwise it is a state of the device itself
            if (objects[expected] ||
                (common.type === definition.type && common.role === definition.role && common.unit === definition.unit)) {
                found.push({ id, expected });
                break;
            }
        }
    }
    return found;
}
//# sourceMappingURL=checkStates.js.map