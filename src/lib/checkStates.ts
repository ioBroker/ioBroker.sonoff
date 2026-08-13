import types from './datapoints';

export interface ShortenedState {
    /** ID of the state with the shortened name */
    id: string;
    /** ID this state has with the corrected name */
    expected: string;
}

/** Keys of the data points which contain "_", grouped by their last part */
function getKeysByLastPart(): { [lastPart: string]: string[] } {
    const keys: { [lastPart: string]: string[] } = {};
    for (const key of Object.keys(types)) {
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
export async function findShortenedStates(adapter: ioBroker.Adapter): Promise<ShortenedState[]> {
    const keysByLastPart = getKeysByLastPart();
    const objects = await adapter.getForeignObjectsAsync(`${adapter.namespace}.*`, 'state');
    const found: ShortenedState[] = [];

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
        if (types[lastPart]) {
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

            const definition = types[key];
            const common = obj.common;
            const expected = `${id.substring(0, dot)}.${path}_${key}`;

            // Either the state with the correct name exists already, or the state was created
            // from exactly this data point - otherwise it is a state of the device itself
            if (
                objects[expected] ||
                (common.type === definition.type && common.role === definition.role && common.unit === definition.unit)
            ) {
                found.push({ id, expected });
                break;
            }
        }
    }

    return found;
}
