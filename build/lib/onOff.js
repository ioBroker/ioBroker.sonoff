"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStateText = normalizeStateText;
exports.parseOnOff = parseOnOff;
exports.learnStateTexts = learnStateTexts;
/**
 * Tasmota reports switch states with the texts of "StateText1" (OFF) and "StateText2" (ON). They can be
 * changed by the user and some localized builds do it, e.g. a German firmware sends "AN" and "AUS".
 * The adapter asks every device for its texts, these lists are used for the rest and until the answer arrives.
 */
const ON_TEXTS = ['ON', 'TRUE', '1', 'AN', 'EIN', 'AAN', 'MARCHE', 'ACCESO', 'ENCENDIDO', 'LIGADO'];
const OFF_TEXTS = ['OFF', 'FALSE', '0', 'AUS', 'UIT', 'ARRÊT', 'ARRET', 'SPENTO', 'APAGADO', 'DESLIGADO'];
function normalizeStateText(value) {
    if (typeof value === 'string') {
        return value.trim().toUpperCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value.toString().toUpperCase();
    }
    return '';
}
/** Convert an ON/OFF text into a boolean, undefined if the text is unknown */
function parseOnOff(value, stateTexts) {
    const text = normalizeStateText(value);
    if (!text) {
        return undefined;
    }
    if (stateTexts?.on === text) {
        return true;
    }
    if (stateTexts?.off === text) {
        return false;
    }
    if (ON_TEXTS.includes(text)) {
        return true;
    }
    if (OFF_TEXTS.includes(text)) {
        return false;
    }
    return undefined;
}
/**
 * Remember the texts from an answer like {"StateText1":"AUS"} or {"StateText2":"AN"}.
 * Returns false if the data does not contain any of them.
 */
function learnStateTexts(data, stateTexts) {
    let learned = false;
    if (typeof data.StateText1 === 'string' && data.StateText1.trim()) {
        stateTexts.off = normalizeStateText(data.StateText1);
        learned = true;
    }
    if (typeof data.StateText2 === 'string' && data.StateText2.trim()) {
        stateTexts.on = normalizeStateText(data.StateText2);
        learned = true;
    }
    return learned;
}
//# sourceMappingURL=onOff.js.map