// taken here https://github.com/mqttjs/create-stream-server/blob/master/index.js
'use strict';
const net = require('net');

module.exports = function (serverConfig, clientStreamHandler) {
    let config = JSON.parse(JSON.stringify(serverConfig));
    let connections = {};

    config.port = config.port || 1883;
    config.host = config.host || 'localhost';

    let server = net.createServer(function (client) {
        clientStreamHandler(client);
    });

    server._css_host = config.host;
    server._css_port = config.port;

    return {
        server: server,
        listen: function (callback) {
            server.listen(server._css_port, server._css_host, function () {
                server.on('connection', function (conn) {
                    let key = conn.remoteAddress + ':' + conn.remotePort;
                    connections[key] = conn;
                    conn.on('close', function() {
                        delete connections[key];
                    });
                });

                server.destroy = function (cb) {
                    server.close(cb);
                    for (let key in connections) {
                        if (connections.hasOwnProperty(key)) {
                            connections[key].destroy();
                        }
                    }
                };

                return callback && callback ();
            });
        },
        close: function (callback) {
            server.close(callback);
        },
        destroy: function (callback) {
            server.destroy && server.destroy(callback);
        }
    };
};
