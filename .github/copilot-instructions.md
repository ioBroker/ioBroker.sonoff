# Copilot Instructions for ioBroker.sonoff

## Project Overview

This is an ioBroker adapter for Sonoff/Tasmota devices that enables MQTT communication between ioBroker and ESP8266/ESP32-based Sonoff devices running Tasmota firmware.

## Repository Structure

- `admin/` - Admin UI configuration files and translations
- `lib/` - Core library files
  - `datapoints.js` - Defines all supported Tasmota datapoints and their properties
  - `server.js` - Main MQTT server implementation
- `main.js` - Adapter entry point
- `test/` - Test files
  - `testServer.js` - Integration tests for MQTT message processing
  - `testPackageFiles.js` - Validates package.json and io-package.json

## Key Concepts

### Datapoints
Datapoints in `lib/datapoints.js` define how Tasmota device parameters are mapped to ioBroker states. Each datapoint has:
- `type` - Data type (string, number, boolean)
- `role` - ioBroker role (state, level, switch, etc.)
- `read/write` - Access permissions
- Optional `min/max` - Value ranges

### MQTT Message Processing
The adapter processes MQTT messages from Tasmota devices:
- `tele/*/STATE` - Telemetry status messages
- `tele/*/SENSOR` - Sensor data messages  
- `stat/*/RESULT` - Command responses
- `cmnd/*` - Commands to devices

### Testing
Tests in `testServer.js` use a mock MQTT setup with predefined message rules that verify:
- MQTT messages are correctly parsed
- Datapoints are created with expected values
- State changes trigger correct MQTT publications

## Development Guidelines

1. **Adding New Datapoints**: Update `lib/datapoints.js` with proper type definitions
2. **Testing**: Add corresponding test cases in `testServer.js` with real MQTT message examples
3. **Translations**: Update admin UI translations in `admin/i18n/*/translations.json`
4. **Changelog**: Add entries to README.md under `### **WORK IN PROGRESS**` section for user-facing changes. DO NOT modify `io-package.json` news section as it's automatically updated during releases
5. **Compatibility**: Maintain backward compatibility with existing Tasmota configurations

## Code Style

- Use strict mode and JSHint directives
- Follow existing patterns for consistency
- Use meaningful variable names
- Add comments for complex logic
- Prefer ES6 features where appropriate

## Testing Strategy

- Integration tests validate end-to-end MQTT processing
- Use realistic Tasmota message examples
- Test both positive and negative scenarios
- Ensure all new datapoints have corresponding tests