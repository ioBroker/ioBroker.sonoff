// taken here https://github.com/mqttjs/create-stream-server/blob/master/index.js

var net = require('net');

module.exports = function (serverConfig, clientStreamHandler) {
    var config = JSON.parse(JSON.stringify(serverConfig));
    var connections = {};

    config.port = config.port || 1883;
    config.host = config.host || 'localhost';

    var server = net.createServer(function (client) {
        clientStreamHandler(client);
    });

    server._css_host = config.host;
    server._css_port = config.port;

    return {
        server: server,
        listen: function (callback) {
            server.listen(server._css_port, server._css_host, function () {
                server.on('connection', function (conn) {
                    var key = conn.remoteAddress + ':' + conn.remotePort;
                    connections[key] = conn;
                    conn.on('close', function() {
                        delete connections[key];
                    });
                });

                server.destroy = function (cb) {
                    server.close(cb);
                    for (var key in connections) {
                        connections[key].destroy();
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
