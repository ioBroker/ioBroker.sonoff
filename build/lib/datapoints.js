'use strict';

/**
 * Known Tasmota datapoints with proper ioBroker common definitions.
 * Keys match the Tasmota JSON keys as found in SENSOR, STATE, RESULT messages.
 */
const datapoints = {
    // --- Power / Relay ---
    POWER:  { common: { name: 'Power',  type: 'boolean', role: 'switch', read: true, write: true } },
    POWER1: { common: { name: 'Power 1', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER2: { common: { name: 'Power 2', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER3: { common: { name: 'Power 3', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER4: { common: { name: 'Power 4', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER5: { common: { name: 'Power 5', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER6: { common: { name: 'Power 6', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER7: { common: { name: 'Power 7', type: 'boolean', role: 'switch', read: true, write: true } },
    POWER8: { common: { name: 'Power 8', type: 'boolean', role: 'switch', read: true, write: true } },

    // --- Switch ---
    Switch1: { common: { name: 'Switch 1', type: 'boolean', role: 'switch', read: true, write: true } },
    Switch2: { common: { name: 'Switch 2', type: 'boolean', role: 'switch', read: true, write: true } },
    Switch3: { common: { name: 'Switch 3', type: 'boolean', role: 'switch', read: true, write: true } },
    Switch4: { common: { name: 'Switch 4', type: 'boolean', role: 'switch', read: true, write: true } },

    // --- Button ---
    Button1: { common: { name: 'Button 1', type: 'string', role: 'text', read: true, write: false } },
    Button2: { common: { name: 'Button 2', type: 'string', role: 'text', read: true, write: false } },
    Button3: { common: { name: 'Button 3', type: 'string', role: 'text', read: true, write: false } },
    Button4: { common: { name: 'Button 4', type: 'string', role: 'text', read: true, write: false } },

    // --- WiFi ---
    Wifi: { common: { name: 'WiFi Info', type: 'string', role: 'json', read: true, write: false } },
    'Wifi.AP':     { common: { name: 'WiFi AP',     type: 'number', role: 'value', read: true, write: false } },
    'Wifi.SSId':   { common: { name: 'WiFi SSID',   type: 'string', role: 'text', read: true, write: false } },
    'Wifi.BSSId':  { common: { name: 'WiFi BSSID',  type: 'string', role: 'text', read: true, write: false } },
    'Wifi.Channel': { common: { name: 'WiFi Channel', type: 'number', role: 'value', read: true, write: false } },
    'Wifi.RSSI':   { common: { name: 'WiFi RSSI',   type: 'number', role: 'value', read: true, write: false, unit: '%' } },
    'Wifi.Signal':  { common: { name: 'WiFi Signal',  type: 'number', role: 'value', read: true, write: false, unit: 'dBm' } },

    // --- General State ---
    Time:      { common: { name: 'Time',      type: 'string', role: 'date', read: true, write: false } },
    Uptime:    { common: { name: 'Uptime',    type: 'string', role: 'text', read: true, write: false } },
    UptimeSec: { common: { name: 'Uptime (sec)', type: 'number', role: 'value', read: true, write: false, unit: 's' } },
    Vcc:       { common: { name: 'VCC',       type: 'number', role: 'value.voltage', read: true, write: false, unit: 'V' } },
    Heap:      { common: { name: 'Free Heap', type: 'number', role: 'value', read: true, write: false, unit: 'kB' } },
    LoadAvg:   { common: { name: 'Load Avg',  type: 'number', role: 'value', read: true, write: false } },
    Sleep:     { common: { name: 'Sleep',      type: 'number', role: 'value', read: true, write: false, unit: 'ms' } },
    MqttCount: { common: { name: 'MQTT Count', type: 'number', role: 'value', read: true, write: false } },

    // --- Dimmer / LED ---
    Dimmer:     { common: { name: 'Dimmer',      type: 'number', role: 'level.dimmer', read: true, write: true, min: 0, max: 100, unit: '%' } },
    Color:      { common: { name: 'Color',       type: 'string', role: 'level.color.rgb', read: true, write: true } },
    HSBColor:   { common: { name: 'HSB Color',   type: 'string', role: 'level.color.hue', read: true, write: true } },
    White:      { common: { name: 'White',       type: 'number', role: 'level.dimmer', read: true, write: true, min: 0, max: 100, unit: '%' } },
    CT:         { common: { name: 'Color Temp',  type: 'number', role: 'level.color.temperature', read: true, write: true, min: 153, max: 500 } },
    Scheme:     { common: { name: 'Scheme',      type: 'number', role: 'value', read: true, write: true, min: 0, max: 12 } },
    Fade:       { common: { name: 'Fade',        type: 'boolean', role: 'switch', read: true, write: true } },
    Speed:      { common: { name: 'Speed',       type: 'number', role: 'value', read: true, write: true, min: 1, max: 40 } },
    LedTable:   { common: { name: 'LED Table',   type: 'boolean', role: 'switch', read: true, write: true } },
    Channel:    { common: { name: 'Channel',     type: 'string', role: 'text', read: true, write: true } },

    // --- Energy (ENERGY object from POW etc.) ---
    'ENERGY.Total':          { common: { name: 'Energy Total',          type: 'number', role: 'value.power.consumption', read: true, write: false, unit: 'kWh' } },
    'ENERGY.Yesterday':      { common: { name: 'Energy Yesterday',      type: 'number', role: 'value.power.consumption', read: true, write: false, unit: 'kWh' } },
    'ENERGY.Today':          { common: { name: 'Energy Today',          type: 'number', role: 'value.power.consumption', read: true, write: false, unit: 'kWh' } },
    'ENERGY.Power':          { common: { name: 'Power',                 type: 'number', role: 'value.power',             read: true, write: false, unit: 'W' } },
    'ENERGY.ApparentPower':  { common: { name: 'Apparent Power',        type: 'number', role: 'value.power',             read: true, write: false, unit: 'VA' } },
    'ENERGY.ReactivePower':  { common: { name: 'Reactive Power',        type: 'number', role: 'value.power',             read: true, write: false, unit: 'VAr' } },
    'ENERGY.Factor':         { common: { name: 'Power Factor',          type: 'number', role: 'value',                   read: true, write: false } },
    'ENERGY.Voltage':        { common: { name: 'Voltage',               type: 'number', role: 'value.voltage',           read: true, write: false, unit: 'V' } },
    'ENERGY.Current':        { common: { name: 'Current',               type: 'number', role: 'value.current',           read: true, write: false, unit: 'A' } },
    'ENERGY.Frequency':      { common: { name: 'Frequency',             type: 'number', role: 'value',                   read: true, write: false, unit: 'Hz' } },

    // --- Temperature / Humidity / Pressure Sensors ---
    'Temperature':    { common: { name: 'Temperature',    type: 'number', role: 'value.temperature', read: true, write: false, unit: '°C' } },
    'Humidity':       { common: { name: 'Humidity',        type: 'number', role: 'value.humidity',    read: true, write: false, unit: '%' } },
    'Pressure':       { common: { name: 'Pressure',        type: 'number', role: 'value.pressure',   read: true, write: false, unit: 'hPa' } },
    'DewPoint':       { common: { name: 'Dew Point',       type: 'number', role: 'value.temperature', read: true, write: false, unit: '°C' } },
    'Gas':            { common: { name: 'Gas',             type: 'number', role: 'value',             read: true, write: false } },
    'Illuminance':    { common: { name: 'Illuminance',     type: 'number', role: 'value.brightness',  read: true, write: false, unit: 'lx' } },
    'UvLevel':        { common: { name: 'UV Level',        type: 'number', role: 'value',             read: true, write: false } },
    'UvPower':        { common: { name: 'UV Power',        type: 'number', role: 'value',             read: true, write: false } },

    // --- Distance / Weight ---
    'Distance':       { common: { name: 'Distance',        type: 'number', role: 'value.distance',   read: true, write: false, unit: 'cm' } },
    'Weight':         { common: { name: 'Weight',          type: 'number', role: 'value',             read: true, write: false, unit: 'kg' } },

    // --- Shutter ---
    'Shutter1':       { common: { name: 'Shutter 1',      type: 'number', role: 'level.blind', read: true, write: true, min: 0, max: 100, unit: '%' } },
    'Shutter2':       { common: { name: 'Shutter 2',      type: 'number', role: 'level.blind', read: true, write: true, min: 0, max: 100, unit: '%' } },
    'Shutter3':       { common: { name: 'Shutter 3',      type: 'number', role: 'level.blind', read: true, write: true, min: 0, max: 100, unit: '%' } },
    'Shutter4':       { common: { name: 'Shutter 4',      type: 'number', role: 'level.blind', read: true, write: true, min: 0, max: 100, unit: '%' } },

    // --- PulseTime ---
    'PulseTime1':     { common: { name: 'PulseTime 1', type: 'number', role: 'value', read: true, write: true, unit: 's' } },
    'PulseTime2':     { common: { name: 'PulseTime 2', type: 'number', role: 'value', read: true, write: true, unit: 's' } },
    'PulseTime3':     { common: { name: 'PulseTime 3', type: 'number', role: 'value', read: true, write: true, unit: 's' } },
    'PulseTime4':     { common: { name: 'PulseTime 4', type: 'number', role: 'value', read: true, write: true, unit: 's' } },

    // --- PWM ---
    'PWM.PWM1':       { common: { name: 'PWM 1', type: 'number', role: 'level', read: true, write: true, min: 0, max: 1023 } },
    'PWM.PWM2':       { common: { name: 'PWM 2', type: 'number', role: 'level', read: true, write: true, min: 0, max: 1023 } },
    'PWM.PWM3':       { common: { name: 'PWM 3', type: 'number', role: 'level', read: true, write: true, min: 0, max: 1023 } },
    'PWM.PWM4':       { common: { name: 'PWM 4', type: 'number', role: 'level', read: true, write: true, min: 0, max: 1023 } },
    'PWM.PWM5':       { common: { name: 'PWM 5', type: 'number', role: 'level', read: true, write: true, min: 0, max: 1023 } },
};

module.exports = datapoints;
