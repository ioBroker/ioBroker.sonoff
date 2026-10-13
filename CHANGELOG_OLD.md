# Older changes
## 3.3.0 (2025-09-20)
* (@Apollon77/@copilot) **IMPORTANT**: Commands now correctly use `cmnd/` prefix instead of `tele/` prefix
* (@Apollon77/@copilot) Added configuration for advanced MQTT settings
* (@Apollon77/@copilot) Fixed shutter command mapping to use the correct Tasmota format - Transforms Shutter1_Position to ShutterPosition1 for proper device control
* (@Apollon77/@copilot) Fixed IRHVAC Power, Light and Mode fields showing NULL instead of actual string values
* (@Apollon77/@copilot) Added Zigbee device control support for Tasmota coordinators - users can now control Zigbee devices (Power/Dimmer) through ioBroker states via automatic ZbSend command generation
* (@Apollon77/@copilot) Added support for Tasmota tele/MARGINS messages enabling integration of PowerLow, PowerHigh, and PowerDelta limits
* (@Apollon77/@copilot) Fixed POW R2 energy datapoints not being created by enabling TELE_STATE by default
* (@Apollon77/@copilot) Fixed pressure and temperature unit display to respect PressureUnit and TempUnit from Tasmota MQTT messages
* (@Apollon77/@copilot) Added support for decoupled button actions in Tasmota devices - creates Button1-Button8 datapoints for button events
* (@Apollon77/@copilot) Fixed RESULT message processing bug where tele/*/RESULT messages were incorrectly processed as WAKEUP instead of RESULT
* (@Apollon77/@copilot) Fixed the deprecated value.power.consumption role for ENERGY_Power datapoint to improve device detection
* (@Apollon77/@copilot) Added support for SHUTTER5-SHUTTER16 datapoints for ESP32 shutter32 devices
* (@Apollon77/@copilot) Updated admin UI responsive design to use ioBroker standard values for mobile compatibility
* (@Apollon77/@copilot) Added support for Sonoff B1 (RGB LED) and Sonoff SC (Environmental Sensor) devices with proper value ranges
* (@Apollon77/@copilot) Added meaningful state labels for Scheme datapoint (color animation schemes)
* (@Apollon77/@copilot) Added a configuration option to suppress "not connected" warnings for temporarily offline devices
* (@Apollon77/@copilot) Added Switch5-Switch28 datapoint definitions for consistent boolean mapping
* (@Apollon77/@copilot) Fixed a write flag for all Switch datapoints to enable proper control from ioBroker

## 3.2.1 (2024-10-07)

* (bluefox) Sanitize the IDs of the clients

## 3.2.0 (2024-08-28)
* (bluefox) Added information about connected clients in the server mode

[Older changelogs can be found there](CHANGELOG_OLD.md)

## 3.1.2 (2024-08-17)
* (mattreim) updated packages

## 3.1.1 (2024-08-09)
* (mattreim) updated packages

## 3.1.0 (2024-05-25)
* Important: Node.js 18.x and js-controller 5.0.19+ are necessary at minimum
* (mattreim) upgraded states for Tasmota 13.4.0.3 20240402
* (mattreim) enhanced some log messages
* (mattreim) Added PWM Items
* (Apollon77) Fixed QoS handling to prevent invalid resubmissions
* (Apollon77) Prevent creation of storeMap property in common and cleanup

## 3.0.3 (2023-09-25)
* (bluefox/Bettman66) Added migration of password on JSON Config

## 2.5.7 (2023-07-07)
* (mcm1957) Disabled the logging of username and password during connection errors
* (bluefox) added json config

## 2.5.3 (2023-03-30)
* (GreatSUN) Implemented potential `.STATE.POWER` update

## 2.5.1 (2022-04-23)
* (Apollon77) Fixed the crash case reported by Sentry

## 2.5.0 (2022-03-21)
* (GreatSUN) Implement writing of NSPanel Widget changes
* (Apollon77) Fixed the crash case reported by Sentry

## 2.4.7 (2021-11-14)
* (Apollon77) Fix crash case (Sentry IOBROKER-SONOFF-1S)

## 2.4.6 (2021-11-13)
* (Apollon77) Fix some crash cases reported by Sentry (IOBROKER-SONOFF-B, IOBROKER-SONOFF-R, IOBROKER-SONOFF-4, IOBROKER-SONOFF-1, IOBROKER-SONOFF-13, IOBROKER-SONOFF-1J, IOBROKER-SONOFF-16, IOBROKER-SONOFF-3, IOBROKER-SONOFF-H)
* (Apollon77) Adjust Uptime to mixed because it seems that it can be number or string

## 2.4.5 (2021-07-21)
* (Apollon77) Fix some crash cases reported by Sentry

## 2.4.4 (2021-07-19)
* (bluefox) Added UvaIntensity and UvbIntensity

## 2.4.3 (2021-07-18)
* (bluefox) Better type detection for non-described states

## 2.4.2 (2021-07-17)
* (bluefox) Optimize for js-controller 3.3

## 2.4.1 (2021-07-17)
* (Apollon77/bluefox) Optimize for js-controller 3.3
* (Apollon77) Add Sentry for error reporting with js-controller 3.x+

## 2.4.0 (2021-02-04)
* (anwa) add several data points
* (anwa) Fix translation for 'ignorePings'
* (anwa) Fixed the wrong unit for humidity
* (anwa) Config option to create a complete object tree instead of a flat structure
* (anwa) Change Action type to string
* (Apollon77) js-controller 2.0 is required at least

## 2.3.3 (2019-11-27)
* (bluefox) Error with the empty packet was caught

## 2.3.2 (2019-10-23)
* (bluefox) Fixed the password input in the configuration
* (bluefox) Allowed setting the IP interface for server
* (bluefox) Fixed tests for js-controller 2.0
* (bluefox) Fixed the monitoring of the client connection
* (bluefox) Changed "indicator.connected" to "indicator.reachable" for clients
* (bluefox) Supported `{POWERn: "true"}`
* (bluefox) Correct processing of `{temp: nan}`

## 2.2.3 (2019-01-10)
* (simatec) Support for compact mode

## 2.2.2 (2018-06-22)
* (bluefox) Configuration was fixed

## 2.2.1 (2018-06-20)
* (bluefox) '-' in names was allowed again

## 2.2.0 (2018-05-22)
* (gemu2015) auto generate objects, support for arrays (channel), led-controllers improved

## 2.1.3 (2018-05-08)
* (bluefox) Added HC-SR04 Ultrasonic Sensor

## 2.1.2 (2018-04-23)
* (bluefox) Added support of UvLight, Longitude and Latitude

## 2.1.1 (2018-04-13)
* (bluefox) Support of the particle concentration sensor

## 2.1.0 (2018-03-30)
* (gemu2015) Support of the devices control (many thanks :)
* (gemu2015) Support of many new values
* (modmax) Update alive status of the clients
* (modmax) Added POWER5-8 and Switch3-4

## 2.0.2 (2018-03-19)
* (modmax) Fixing reconnection of clients
* (bluefox) Add SeaPressure

## 2.0.1 (2018-03-17)
* (bluefox) Replace stream handler
* (bluefox) Add timeout for clients
* (bluefox) Add Light/Noise/AirQuality
* (bluefox) Do not send pingresp for invalid clients

## 1.0.3 (2018-03-03)
* (bluefox) Add Analog0/1/2/3 sensor

## 1.0.2 (2018-02-17)
* (Apollon77) Add Illuminance sensor

## 1.0.1 (2018-02-05)
* (bluefox) Ready for admin3
* (bluefox) Added CO2 sensor

## 1.0.0 (2017-11-27)
* (AlZiBa) typo @ alive
* (AlZiBa) add Today's power consumption for Sonoff POW
* (AlZiBa) unit of power consumption is kWh

## 0.3.3 (2017-11-03)
* (bluefox) Add counters

## 0.3.2 (2017-10-22)
* (Tan-DE) Small change for Switch1. Switch2 and additional IPaddress added.

## 0.3.1 (2017-10-12)
* (bluefox) Fix tests and LWT

## 0.3.0 (2017-10-06)
* (bluefox) Add INFO and ESP

## 0.2.0 (2017-10-05)
* (bluefox) Add ENERGY and DS18x20

## 0.1.0 (2017-10-01)
* (bluefox) initial commit
