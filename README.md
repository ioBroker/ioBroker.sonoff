![Logo](admin/sonoff.png)
# ioBroker Sonoff

![Number of Installations](http://iobroker.live/badges/sonoff-installed.svg)
![Number of Installations](http://iobroker.live/badges/sonoff-stable.svg)
[![NPM version](http://img.shields.io/npm/v/iobroker.sonoff.svg)](https://www.npmjs.com/package/iobroker.sonoff)

![Test and Release](https://github.com/ioBroker/ioBroker.sonoff/workflows/Test%20and%20Release/badge.svg)
[![Translation status](https://weblate.iobroker.net/widgets/adapters/-/sonoff/svg-badge.svg)](https://weblate.iobroker.net/engage/adapters/?utm_source=widget)
[![Downloads](https://img.shields.io/npm/dm/iobroker.sonoff.svg)](https://www.npmjs.com/package/iobroker.sonoff)

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** For more details and for information how to disable the error reporting see [Sentry-Plugin Documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry)! Sentry reporting is used starting with js-controller 3.0.

## Comparison of ioBroker adapters using MQTT protocol
If you only have Tasmotas speaking MQTT protocol go for `ioBroker.sonoff`.
For other scenarios, consider the different options:

| Feature                                       | ioBroker.sonoff  | [ioBroker.mqtt](https://github.com/ioBroker/ioBroker.mqtt/) (in broker mode)  | [ioBroker.mqtt](https://github.com/ioBroker/ioBroker.mqtt/) (in client mode) | [ioBroker.mqtt-client](https://github.com/Pmant/ioBroker.mqtt-client/) |
|-----------------------------------------------|------------------|-------------------------------------------------------------------------------|------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Has a built-in MQTT broker                    | yes              | yes                                                                           | no                                                                           | no                                                                     |
| Relays messages to other MQTT subscribers     | NO!!!            | yes                                                                           | not applicable                                                               | not applicable                                                         |
| External MQTT broker                          | supported (v4+)  | unsupported                                                                   | required                                                                     | required                                                               |
| Tasmota MQTT messages to ioBroker Objects     | smart processing | 1:1 processing of all messages                                                | 1:1 processing of subscribed messages                                        | 1:1 processing of subscribed messages                                  |
| non-Tasmota MQTT messages to ioBroker Objects | no processing    | 1:1 processing of all messages                                                | 1:1 processing of subscribed messages                                        | 1:1 processing of subscribed messages                                  |
| publish ioBroker values as MQTT messages      | none             | configured subtrees                                                           | configured subtrees                                                          | individually configured values                                         |

## MQTT Modi / MQTT Modes

Seit Version 4.0.0 unterstützt der Adapter zwei Betriebsmodi:

### Server-Modus (Eingebauter Broker) - Standard
Der Adapter betreibt seinen eigenen MQTT-Broker. Tasmota-Geräte verbinden sich direkt mit ioBroker. Dies ist das ursprüngliche Verhalten und die einfachste Einrichtung: Konfigurieren Sie den Port und richten Sie Ihre Tasmota-Geräte auf die ioBroker-IP.

### Client-Modus (Externer Broker)
Der Adapter verbindet sich als Client mit einem externen MQTT-Broker (z.B. Mosquitto, EMQX, HiveMQ). Dies ist nützlich wenn:
- Sie bereits einen zentralen MQTT-Broker in Ihrem Netzwerk betreiben
- Mehrere Systeme dieselben MQTT-Nachrichten nutzen sollen
- Sie erweiterte MQTT-Funktionen wie Message Bridging, ACLs oder Clustering benötigen

#### Konfiguration für den Client-Modus
1. Setzen Sie **MQTT Modus** auf `Client (Externer Broker)`
2. Geben Sie **Broker Host** (IP-Adresse oder Hostname) und **Broker Port** ein
3. Falls erforderlich, geben Sie **Benutzername** und **Passwort** für die Broker-Authentifizierung ein
4. Aktivieren Sie **TLS/SSL** für verschlüsselte Verbindungen (MQTTS):
   - Der Adapter verbindet sich dann über `mqtts://` statt `mqtt://`
   - Optional können Sie CA-Zertifikat, Client-Zertifikat und Client-Schlüssel für gegenseitige TLS-Authentifizierung angeben
   - Deaktivieren Sie "Selbstsignierte Zertifikate ablehnen" wenn Ihr Broker ein selbstsigniertes Zertifikat verwendet
5. Optional setzen Sie ein **Topic Präfix** wenn Ihre Tasmota-Topics ein eigenes Präfix verwenden (z.B. `tasmota`)
6. Wählen Sie die **Topic-Struktur** passend zu Ihrer Tasmota FullTopic-Konfiguration:
   - **Standard** (`tele/<Gerät>/STATE`): Für Tasmota Standard-FullTopic `%prefix%/%topic%/` (Standard)
   - **Gerät-zuerst** (`<Gerät>/tele/STATE`): Für Tasmota FullTopic `%topic%/%prefix%/` oder `tasmota/%topic%/%prefix%/`
7. Passen Sie bei Bedarf **Keepalive**, **Reconnect-Intervall** und **Clean Session** unter den erweiterten Einstellungen an

#### Beispiel: Mosquitto mit Authentifizierung
```
Broker Host:     192.168.1.100
Broker Port:     1883
Benutzername:    iobroker
Passwort:        ********
```

#### Beispiel: Mosquitto mit TLS (MQTTS)
```
Broker Host:     mqtt.example.com
Broker Port:     8883
TLS/SSL:         ✓
CA-Zertifikat:   /etc/ssl/certs/ca.pem
Benutzername:    iobroker
Passwort:        ********
```

#### Beispiel: Tasmota mit FullTopic `tasmota/%topic%/%prefix%/`
```
Broker Host:     192.168.1.100
Broker Port:     1883
Topic Präfix:    tasmota
Topic-Struktur:  Gerät-zuerst (Gerät/tele/STATE)
```
In Tasmota: `SetOption19 0` und FullTopic `tasmota/%topic%/%prefix%/` konfigurieren.
Topics werden dann als `tasmota/meinGeraet/tele/STATE` gesendet und Befehle als `tasmota/meinGeraet/cmnd/POWER`.

---

Since version 4.0.0 the adapter supports two operating modes:

### Server Mode (Built-in Broker) - Default
The adapter runs its own MQTT broker. Tasmota devices connect directly to ioBroker. This is the original behavior and the simplest setup: just configure the port and point your Tasmota devices to the ioBroker IP.

### Client Mode (External Broker)
The adapter connects as a client to an external MQTT broker (e.g. Mosquitto, EMQX, HiveMQ). This is useful when:
- You already run a central MQTT broker in your network
- Multiple systems need to share the same MQTT messages
- You need advanced MQTT features like message bridging, ACLs, or clustering

#### Configuration for Client Mode
1. Set **MQTT Mode** to `Client (External broker)`
2. Enter the **Broker host** (IP address or hostname) and **Broker port**
3. If required, enter **Username** and **Password** for broker authentication
4. Enable **TLS/SSL** for encrypted connections (MQTTS):
   - The adapter will connect via `mqtts://` instead of `mqtt://`
   - Optionally provide CA certificate, client certificate, and client key paths for mutual TLS authentication
   - Disable "Reject self-signed certificates" if your broker uses a self-signed certificate
5. Optionally set a **Topic prefix** if your Tasmota topics use a custom prefix (e.g. `tasmota`)
6. Select the **Topic structure** matching your Tasmota FullTopic configuration:
   - **Standard** (`tele/<device>/STATE`): For Tasmota default FullTopic `%prefix%/%topic%/`
   - **Device-first** (`<device>/tele/STATE`): For Tasmota FullTopic `%topic%/%prefix%/` or `tasmota/%topic%/%prefix%/`
7. Adjust **Keepalive**, **Reconnect interval**, and **Clean Session** under Advanced Settings if needed

#### Example: Mosquitto with Authentication
```
Broker host:     192.168.1.100
Broker port:     1883
Username:        iobroker
Password:        ********
```

#### Example: Mosquitto with TLS (MQTTS)
```
Broker host:     mqtt.example.com
Broker port:     8883
Enable TLS/SSL:  ✓
CA certificate:  /etc/ssl/certs/ca.pem
Username:        iobroker
Password:        ********
```

#### Example: Tasmota with FullTopic `tasmota/%topic%/%prefix%/`
```
Broker host:      192.168.1.100
Broker port:      1883
Topic prefix:     tasmota
Topic structure:  Device-first (device/tele/STATE)
```
In Tasmota: configure `SetOption19 0` and FullTopic `tasmota/%topic%/%prefix%/`.
Topics will be sent as `tasmota/myDevice/tele/STATE` and commands as `tasmota/myDevice/cmnd/POWER`.

## Usage

This adapter communicates with Sonoff devices with Tasmota firmware or ESP devices via MQTT.

The following topics are expected:
- `tele/DeviceNAME/STATE`
- `tele/DeviceNAME/SENSOR`
- `tele/DeviceNAME/INFOx`
- `tele/DeviceNAME/ENERGY`
- `cmnd/DeviceNAME/POWERx`
- `stat/DeviceNAME/POWERx`
- `/DeviceNAME/BM280/Temperature`
- `/DeviceNAME/BM280/Humidity`
- `/DeviceNAME/BM280/Temperatur`
- `/DeviceNAME/BM280/Feuchtigkeit`
- `/DeviceNAME/BM280/Vcc`
- `/DeviceNAME/BM280/VCC`
- `/DeviceNAME/BM280/Laufzeit`
- `/DeviceNAME/BM280/RSSI`
- `/DeviceNAME/BM280/POWER`
- `/DeviceNAME/BM280/POWER1`
- `/DeviceNAME/BM280/POWER2`
- `/DeviceNAME/BM280/POWER3`
- `/DeviceNAME/BM280/POWER4`
- `/DeviceNAME/BM280/Switch1`
- `/DeviceNAME/BM280/Switch2`
- `/DeviceNAME/BM280/Total`
- `/DeviceNAME/BM280/Today`
- `/DeviceNAME/BM280/heute`
- `/DeviceNAME/BM280/Yesterday`
- `/DeviceNAME/BM280/gestern`
- `/DeviceNAME/BM280/Faktor`
- `/DeviceNAME/BM280/Factor`
- `/DeviceNAME/BM280/Power`
- `/DeviceNAME/BM280/Leistung`
- `/DeviceNAME/BM280/Voltage`
- `/DeviceNAME/BM280/Spannung`
- `/DeviceNAME/BM280/Current`
- `/DeviceNAME/BM280/Strom`
- `/DeviceNAME/BM280/Punkt`
- `/DeviceNAME/BM280/Counter1`
- `/DeviceNAME/BM280/Counter2`
- `/DeviceNAME/BM280/Counter3`
- `/DeviceNAME/BM280/Counter4`
- `/DeviceNAME/BM280/Pressure`
- `/DeviceNAME/BM280/SeaPressure`
- `/DeviceNAME/BM280/Druck`
- `/DeviceNAME/BM280/Approx. Altitude`
- `/DeviceNAME/BM280/Module`
- `/DeviceNAME/BM280/Version`
- `/DeviceNAME/BM280/Hostname`
- `/DeviceNAME/BM280/IPAddress`
- `/DeviceNAME/BM280/IPaddress`
- `/DeviceNAME/BM280/RestartReason`
- `/DeviceNAME/BM280/CarbonDioxide`
- `/DeviceNAME/DHT11/Illuminance`
- `/DeviceNAME/SonoffSC/Light`
- `/DeviceNAME/SonoffSC/Noise`
- `/DeviceNAME/SonoffSC/AirQuality`
- `/DeviceNAME/SDS0X1/PM2.5`
- `/DeviceNAME/SDS0X1/PM10`
- `/DeviceNAME/SDS0X1/UvLevel`
- `/DeviceNAME/SDS0X1/Latitude`
- `/DeviceNAME/SDS0X1/Longitude`
- `/DeviceNAME/SR04/Distance`

**Note**: The list could be easily extended. Please send `Pull Requests` or *debug data* for unknown states to the developer (via issue).

## Auto-creation of objects
In the web config, you can determine which MQTT telegrams create the new objects not in default data points:

* `TELE_SENSOR` - creates objects from `tele/xxx/SENSOR` telegrams
* `TELE_STATE` - creates objects from `tele/xxx/STATE` telegrams
* `STAT_RESULT` - creates objects from `stat/xxx/RESULT` telegrams

Usually TELE_SENSOR should be sufficient for most users.

* `Create object tree` creates objects as tree structure

**Warning!** This option will mess up your sonoff object tree! You have to redo all the settings for storage...
Store the object structure as JSON file, so you can recreate your old structure.
Best is to stop the adapter, delete all objects under sonoff and start the adapter again.

## Flags for LED controllers
The mode states will be created only if the device has one of the states:

- `Red`, `Green`, `Blue`, `WW`, `CW`, `Color`, `RGB_POWER`, `WW_POWER`, `CW_POWER`, `Hue`, `Saturation`

States:

* `modeLedExor` - exor for white LEDs and color LEDs => if the white LEDs are switched on, color LEDs are switched off and vice versa (default true)
* `modeReadColors` - allow for color read from MQTT (default false)

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
## Changelog

### **WORK IN PROGRESS**
* **MAJOR**: Added external MQTT broker support (client mode) - connect to Mosquitto, EMQX, HiveMQ or any MQTT broker
* Added username/password authentication for external broker connections
* Added MQTTS (TLS/SSL) support with certificate configuration for secure connections
* Added topic prefix support for multi-gateway setups
* Added device-first topic structure support for Tasmota FullTopic `%topic%/%prefix%/` (e.g. `tasmota/device/tele/STATE`)
* Added advanced connection settings (keepalive, reconnect interval, clean session)
* Added translations for ru, fr, it, es, pt, nl, pl, uk, zh-cn
* (@Apollon77/@copilot) Add support for OpenBeken LED datapoints (led_enableAll, led_dimmer, led_temperature, led_basecolor_rgb, led_finalcolor_rgbcw, led_basecolor_rgbcw, led_hue, led_saturation) - enables control of OpenBeken LED devices with automatic topic mapping for /get and /set suffixes
* (@Apollon77/@copilot) Add PulseTime1-PulseTime16 datapoint support - users can now read and set PulseTime values directly from ioBroker to control relay auto-off timers

### 3.3.0 (2025-09-20)
* (@Apollon77/@copilot) **IMPORTANT**: Commands now correctly use cmnd/ prefix instead of tele/ prefix
* (@Apollon77/@copilot) Added configuration for advanced MQTT settings
* (@Apollon77/@copilot) Fix shutter command mapping to use correct Tasmota format - Transforms Shutter1_Position to ShutterPosition1 for proper device control
* (@Apollon77/@copilot) Fix IRHVAC Power, Light and Mode fields showing NULL instead of actual string values
* (@Apollon77/@copilot) Add Zigbee device control support for Tasmota coordinators - users can now control Zigbee devices (Power/Dimmer) through ioBroker states via automatic ZbSend command generation
* (@Apollon77/@copilot) Add support for Tasmota tele/MARGINS messages enabling integration of PowerLow, PowerHigh, and PowerDelta limits
* (@Apollon77/@copilot) Fix POW R2 energy datapoints not being created by enabling TELE_STATE by default
* (@Apollon77/@copilot) Fix pressure and temperature unit display to respect PressureUnit and TempUnit from Tasmota MQTT messages
* (@Apollon77/@copilot) Add support for decoupled button actions in Tasmota devices - creates Button1-Button8 datapoints for button events
* (@Apollon77/@copilot) Fix RESULT message processing bug where tele/*/RESULT messages were incorrectly processed as WAKEUP instead of RESULT
* (@Apollon77/@copilot) Fix deprecated value.power.consumption role for ENERGY_Power datapoint to improve device detection
* (@Apollon77/@copilot) Add support for SHUTTER5-SHUTTER16 datapoints for ESP32 shutter32 devices
* (@Apollon77/@copilot) Update admin UI responsive design to use ioBroker standard values for mobile compatibility
* (@Apollon77/@copilot) Add support for Sonoff B1 (RGB LED) and Sonoff SC (Environmental Sensor) devices with proper value ranges
* (@Apollon77/@copilot) Add meaningful state labels for Scheme datapoint (color animation schemes)
* (@Apollon77/@copilot) Add configuration option to suppress "not connected" warnings for temporarily offline devices
* (@Apollon77/@copilot) Add Switch5-Switch28 datapoint definitions for consistent boolean mapping
* (@Apollon77/@copilot) Fix write flag for all Switch datapoints to enable proper control from ioBroker

### 3.2.1 (2024-10-07)

* (bluefox) Sanitize the IDs of the clients

### 3.2.0 (2024-08-28)
* (bluefox) Added information about connected clients in the server mode

### 3.1.2 (2024-08-17)
* (mattreim) updated packages

### 3.1.1 (2024-08-09)
* (mattreim) updated packages

### 3.1.0 (2024-05-25)
* Important: Node.js 18.x and js-controller 5.0.19+ are necessary at minimum
* (mattreim) upgraded states for Tasmota 13.4.0.3 20240402
* (mattreim) enhanced some log messages
* (mattreim) Added PWM Items
* (Apollon77) Fixed QoS handling to prevent invalid resubmissions
* (Apollon77) Prevent creation of storeMap property in common and cleanup

### 3.0.3 (2023-09-25)
* (bluefox/Bettman66) Added migration of password on JSON Config

### 2.5.7 (2023-07-07)
* (mcm1957) Disabled the logging of username and password during connection errors
* (bluefox) added json config

### 2.5.3 (2023-03-30)
* (GreatSUN) Implemented potential `.STATE.POWER` update

### 2.5.1 (2022-04-23)
* (Apollon77) Fixed the crash case reported by Sentry

### 2.5.0 (2022-03-21)
* (GreatSUN) Implement writing of NSPanel Widget changes
* (Apollon77) Fixed the crash case reported by Sentry

### 2.4.7 (2021-11-14)
* (Apollon77) Fix crash case (Sentry IOBROKER-SONOFF-1S)

### 2.4.6 (2021-11-13)
* (Apollon77) Fix some crash cases reported by Sentry (IOBROKER-SONOFF-B, IOBROKER-SONOFF-R, IOBROKER-SONOFF-4, IOBROKER-SONOFF-1, IOBROKER-SONOFF-13, IOBROKER-SONOFF-1J, IOBROKER-SONOFF-16, IOBROKER-SONOFF-3, IOBROKER-SONOFF-H)
* (Apollon77) Adjust Uptime to mixed because it seems that it can be number or string

### 2.4.5 (2021-07-21)
* (Apollon77) Fix some crash cases reported by Sentry

### 2.4.4 (2021-07-19)
* (bluefox) Added UvaIntensity and UvbIntensity

### 2.4.3 (2021-07-18)
* (bluefox) Better type detection for non-described states

### 2.4.2 (2021-07-17)
* (bluefox) Optimize for js-controller 3.3

### 2.4.1 (2021-07-17)
* (Apollon77/bluefox) Optimize for js-controller 3.3
* (Apollon77) Add Sentry for error reporting with js-controller 3.x+

### 2.4.0 (2021-02-04)
* (anwa) add several data points
* (anwa) Fix translation for 'ignorePings'
* (anwa) Fixed the wrong unit for humidity
* (anwa) Config option to create a complete object tree instead of a flat structure
* (anwa) Change Action type to string
* (Apollon77) js-controller 2.0 is required at least

### 2.3.3 (2019-11-27)
* (bluefox) Error with the empty packet was caught

### 2.3.2 (2019-10-23)
* (bluefox) Fixed the password input in the configuration
* (bluefox) Allowed setting the IP interface for server
* (bluefox) Fixed tests for js-controller 2.0
* (bluefox) Fixed the monitoring of the client connection
* (bluefox) Changed "indicator.connected" to "indicator.reachable" for clients
* (bluefox) Supported `{POWERn: "true"}`
* (bluefox) Correct processing of `{temp: nan}`

### 2.2.3 (2019-01-10)
* (simatec) Support for compact mode

### 2.2.2 (2018-06-22)
* (bluefox) Configuration was fixed

### 2.2.1 (2018-06-20)
* (bluefox) '-' in names was allowed again

### 2.2.0 (2018-05-22)
* (gemu2015) auto generate objects, support for arrays (channel), led-controllers improved

### 2.1.3 (2018-05-08)
* (bluefox) Added HC-SR04 Ultrasonic Sensor

### 2.1.2 (2018-04-23)
* (bluefox) Added support of UvLight, Longitude and Latitude

### 2.1.1 (2018-04-13)
* (bluefox) Support of the particle concentration sensor

### 2.1.0 (2018-03-30)
* (gemu2015) Support of the devices control (many thanks :)
* (gemu2015) Support of many new values
* (modmax) Update alive status of the clients
* (modmax) Added POWER5-8 and Switch3-4

### 2.0.2 (2018-03-19)
* (modmax) Fixing reconnection of clients
* (bluefox) Add SeaPressure

### 2.0.1 (2018-03-17)
* (bluefox) Replace stream handler
* (bluefox) Add timeout for clients
* (bluefox) Add Light/Noise/AirQuality
* (bluefox) Do not send pingresp for invalid clients

### 1.0.3 (2018-03-03)
* (bluefox) Add Analog0/1/2/3 sensor

### 1.0.2 (2018-02-17)
* (Apollon77) Add Illuminance sensor

### 1.0.1 (2018-02-05)
* (bluefox) Ready for admin3
* (bluefox) Added CO2 sensor

### 1.0.0 (2017-11-27)
* (AlZiBa) typo @ alive
* (AlZiBa) add Today's power consumption for Sonoff POW
* (AlZiBa) unit of power consumption is kWh

### 0.3.3 (2017-11-03)
* (bluefox) Add counters

### 0.3.2 (2017-10-22)
* (Tan-DE) Small change for Switch1. Switch2 and additional IPaddress added.

### 0.3.1 (2017-10-12)
* (bluefox) Fix tests and LWT

### 0.3.0 (2017-10-06)
* (bluefox) Add INFO and ESP

### 0.2.0 (2017-10-05)
* (bluefox) Add ENERGY and DS18x20

### 0.1.0 (2017-10-01)
* (bluefox) initial commit

## License

The MIT License (MIT)

Copyright (c) 2017-2026, bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
