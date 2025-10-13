# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.2
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Adapter-Specific Context: Sonoff/Tasmota MQTT Integration

This is an ioBroker adapter for Sonoff/Tasmota devices that enables MQTT communication between ioBroker and ESP8266/ESP32-based Sonoff devices running Tasmota firmware.

**Key Features:**
- MQTT server/client implementation for Tasmota devices
- Automatic device discovery and state mapping
- Support for sensors, switches, relays, LED controllers, and more
- Dynamic datapoint creation from MQTT telegrams

**Repository Structure:**
- `admin/` - Admin UI configuration files and translations
- `lib/` - Core library files
  - `datapoints.js` - Defines all supported Tasmota datapoints and their properties
  - `server.js` - Main MQTT server implementation
- `main.js` - Adapter entry point
- `test/` - Test files
  - `integration.js` - Integration tests for MQTT message processing
  - `testPackageFiles.js` - Validates package.json and io-package.json

**Key Concepts:**

#### Datapoints
Datapoints in `lib/datapoints.js` define how Tasmota device parameters are mapped to ioBroker states. Each datapoint has:
- `type` - Data type (string, number, boolean)
- `role` - ioBroker role (state, level, switch, etc.)
- `read/write` - Access permissions
- Optional `min/max` - Value ranges

#### MQTT Message Processing
The adapter processes MQTT messages from Tasmota devices:
- `tele/*/STATE` - Telemetry status messages
- `tele/*/SENSOR` - Sensor data messages
- `stat/*/RESULT` - Command responses
- `cmnd/*` - Commands to devices

**Development Guidelines:**
1. **Adding New Datapoints**: Update `lib/datapoints.js` with proper type definitions
2. **Testing**: Add corresponding test cases in `test/integration.js` with real MQTT message examples
3. **Translations**: When adding new UI elements to admin configuration:
   - Add all English text entries to `admin/i18n/en/translations.json`
   - Run `npm run translate` to automatically generate translations for all supported languages
   - Verify translations were created in all language directories under `admin/i18n/`
4. **Changelog**: Add entries to README.md under `### **WORK IN PROGRESS**` section for user-facing changes. DO NOT modify `io-package.json` news section as it's automatically updated during releases
5. **Linting**: Always run `npm run lint` to verify code passes ESLint validation
6. **Compatibility**: Maintain backward compatibility with existing Tasmota configurations

**Code Style:**
- Use strict mode and JSHint directives
- Follow existing patterns for consistency
- Use meaningful variable names
- Add comments for complex logic
- Prefer ES6 features where appropriate

**Testing Strategy:**
- Integration tests validate end-to-end MQTT processing using `@iobroker/testing` framework
- Use realistic Tasmota message examples
- Test both positive and negative scenarios
- Ensure all new datapoints have corresponding tests

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Configure adapter
                        await harness.changeAdapterConfig('adaptername', {
                            native: {
                                configKey: 'configValue'
                            }
                        });

                        // Start adapter
                        await harness.startAdapterAndWait();

                        // Verify states
                        const state = await harness.getState('adaptername.0.someState');
                        expect(state).toBeDefined();
                        expect(state.val).toBe(expectedValue);

                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        });
    }
});
```

#### Key Patterns
- Always use `tests.integration(path.join(__dirname, '..'), {...})` as entry point
- Use `defineAdditionalTests({ suite })` for custom tests
- Use `getHarness()` to access test harness
- Use `harness.startAdapterAndWait()` to start adapter
- Use `harness.getState()` to read state values
- Use `harness.setState()` to write state values
- Use `harness.changeAdapterConfig()` to modify configuration

#### Complete Example
```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Custom tests for my adapter', (getHarness) => {
            it('Test 1: Start adapter and check initial state', async function() {
                const harness = getHarness();
                
                // Start the adapter and wait until it has started
                await harness.startAdapterAndWait();
                
                // Check if state exists
                const state = await harness.getState('adaptername.0.info.connection');
                expect(state).toBeDefined();
                expect(state.val).toBe(true);
            });

            it('Test 2: Change adapter configuration', async function() {
                const harness = getHarness();
                
                // Change native configuration
                await harness.changeAdapterConfig('adaptername', {
                    native: {
                        interval: 60000,
                        someOption: true
                    }
                });
                
                await harness.startAdapterAndWait();
                
                // Verify adapter behavior with new config
                // ...
            });
        });
    }
});
```

### Testing Best Practices
1. **Framework Usage**: Always use `@iobroker/testing` - never write custom adapter initialization
2. **Async Handling**: Use async/await for all asynchronous operations
3. **State Verification**: Always verify state changes after operations
4. **Error Handling**: Test both success and error scenarios
5. **Configuration**: Test different configuration scenarios
6. **Cleanup**: Harness handles cleanup automatically
7. **Timeouts**: Use appropriate timeouts for operations (default: 30 seconds)

## Core Development Principles

### Adapter Structure
- Main adapter code goes in `main.js` (entry point) or a modular structure with `lib/` directory
- Admin UI configuration in `admin/` directory
- Adapter metadata in `io-package.json`
- npm package information in `package.json`

### State Management
- Use `await this.setStateAsync(id, value, ack)` for setting states (ack: true for values from device, false for user commands)
- Use `await this.getStateAsync(id)` for reading states
- Always use `await this.setObjectNotExistsAsync()` before creating states
- Define state objects with proper common properties:
  ```javascript
  await this.setObjectNotExistsAsync('stateName', {
      type: 'state',
      common: {
          name: 'Human readable name',
          type: 'number',
          role: 'value',
          read: true,
          write: false,
          unit: '°C'
      },
      native: {}
  });
  ```

### Lifecycle Methods
```javascript
class MyAdapter extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'adaptername',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        // Initialize your adapter here
        // Subscribe to state changes
        this.subscribeStates('*');
    }

    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    onMessage(obj) {
        // Handle messages from admin UI or other adapters
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // Handle the send command
                this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
            }
        }
    }

    onUnload(callback) {
        try {
            // Clean up resources here
            // Stop intervals, close connections, etc.
            callback();
        } catch (e) {
            callback();
        }
    }
}
```

### Error Handling
- Always use try-catch blocks for async operations
- Log errors with appropriate severity levels
- Provide meaningful error messages for users
- Implement graceful degradation
- Use `this.log.error()`, `this.log.warn()`, `this.log.info()`, `this.log.debug()`

### Configuration
- Define configuration schema in `io-package.json` under `native`
- Access configuration via `this.config.parameterName`
- Validate configuration values in `onReady()`
- Support JSON configuration UI (admin5+)

### Object and State IDs
- Use hierarchical structure: `adaptername.instance.category.subcategory.state`
- Use meaningful, descriptive names
- Follow naming conventions: camelCase for JavaScript, lowercase with dots for states
- Sanitize user input used in IDs (remove special characters)

### Dependencies and npm
- List all runtime dependencies in `package.json` under `dependencies`
- Use exact versions or narrow ranges (e.g., `^1.2.3` rather than `*`)
- Keep dependencies up to date but test thoroughly before updating

## Translation and Internationalization

### Admin UI
- Store translations in `admin/i18n/[language]/translations.json`
- Supported languages: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn
- Use translation keys in admin HTML: `<span data-i18n="translationKey"></span>`
- For JSON config UI, define translations directly in `io-package.json`

### Code Messages
- Define translatable strings in `io-package.json` under `common.messages`
- Access translations in code: `this.log.info(this._(messageKey))`

### Translation Workflow
When adding new UI text to admin configuration:
1. Add English text entries to `admin/i18n/en/translations.json`
2. Run `npm run translate` to automatically generate translations for all languages
3. Review and verify translations were created in all language directories

## ioBroker Best Practices

### Logging
- Use appropriate log levels:
  - `error`: Critical errors requiring immediate attention
  - `warn`: Warning conditions that should be addressed
  - `info`: General informational messages (default visibility)
  - `debug`: Detailed debugging information (only visible when debug logging is enabled)
- Include context in log messages (device names, state IDs, etc.)
- Don't log sensitive information (passwords, API keys)

### Performance
- Use intervals wisely - don't poll too frequently
- Implement debouncing for rapidly changing values
- Clean up timers and intervals in `onUnload()`
- Use `setStateChanged()` to only update when value actually changes

### Security
- Never store passwords in plain text
- Use `this.encrypt()` and `this.decrypt()` for sensitive data
- Validate all user input
- Use HTTPS for external API calls when available
- Follow principle of least privilege

### Compatibility
- Support js-controller 5.0+ (check `io-package.json` engine requirements)
- Test with different Node.js versions (see GitHub Actions)
- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Document breaking changes in changelog

## Common Patterns

### Polling Pattern
```javascript
class MyAdapter extends utils.Adapter {
    onReady() {
        this.updateInterval = setInterval(() => {
            this.updateData();
        }, this.config.interval || 60000);
    }

    async updateData() {
        try {
            // Fetch and update data
        } catch (error) {
            this.log.error(`Error updating data: ${error.message}`);
        }
    }

    onUnload(callback) {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        callback();
    }
}
```

### Connection Management
```javascript
async onReady() {
    await this.setStateAsync('info.connection', false, true);
    try {
        await this.connect();
        await this.setStateAsync('info.connection', true, true);
    } catch (error) {
        this.log.error(`Connection failed: ${error.message}`);
    }
}
```

### State Change Handling
```javascript
onStateChange(id, state) {
    if (!state || state.ack) return; // Ignore acknowledged states
    
    // Parse the state ID
    const idParts = id.split('.');
    const command = idParts[idParts.length - 1];
    
    // Handle the command
    this.handleCommand(command, state.val);
}
```

## Code Quality

### Linting and Formatting
- Use ESLint with ioBroker configuration
- Run `npm run lint` before committing
- Configure ESLint in `eslint.config.mjs` or `.eslintrc.json`
- Use Prettier for consistent code formatting

### Code Review Checklist
- [ ] All async operations use await and proper error handling
- [ ] No blocking operations in main thread
- [ ] Resources cleaned up in onUnload()
- [ ] States have proper roles and types
- [ ] Configuration validated
- [ ] Meaningful log messages
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Changelog updated

## Release Process

### Version Bumping
1. Update version in `package.json`
2. Update version in `io-package.json`
3. Add changelog entry in README.md under `### **WORK IN PROGRESS**`
4. Ensure all tests pass
5. Commit changes
6. Create git tag
7. GitHub Actions will automatically publish to npm

### Changelog Format
```markdown
### X.Y.Z (YYYY-MM-DD)
* (developer) Description of change
* (developer) Another change
```

## Resources

- ioBroker Developer Documentation: https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md
- Adapter Testing Framework: https://github.com/ioBroker/testing
- ioBroker Type Definitions: https://github.com/ioBroker/ioBroker.js-controller
- Adapter Development Template: https://github.com/ioBroker/ioBroker.template
- ioBroker Forum: https://forum.iobroker.net/
- Discord Community: https://discord.gg/5jGWNKnpZ8
