module.exports = function(RED) {
    "use strict";
    var settings = RED.settings;
    var events = require("events");
    var serialp = require("serialport");
    var bufMaxSize = 32768; // Max serial buffer size, for inputs...

    // TODO: 'serialPool' should be encapsulated in SerialPortNode

    function SerialPortNode(n) {
        RED.nodes.createNode(this, n);
        this.serialport = n.serialport;
        this.newline = n.newline;
        this.addchar = n.addchar || "false";
        this.serialbaud = parseInt(n.serialbaud) || 57600;
        this.databits = parseInt(n.databits) || 8;
        this.parity = n.parity || "none";
        this.stopbits = parseInt(n.stopbits) || 1;
        this.bin = n.bin || "false";
        this.out = n.out || "char";
        this.flowcontrol = n.flowcontrol || "none";
    }
    RED.nodes.registerType("RS485 serial-port", SerialPortNode);

    function SerialOutNode(n) {
        RED.nodes.createNode(this, n);
        this.serial = n.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            node.port = serialPool.get(this.serialConfig.serialport,
                this.serialConfig.serialbaud,
                this.serialConfig.databits,
                this.serialConfig.parity,
                this.serialConfig.stopbits,
                this.serialConfig.newline,
                this.serialConfig.flowcontrol);
            node.addCh = "";
            if (node.serialConfig.addchar == "true" || node.serialConfig.addchar === true) {
                node.addCh = this.serialConfig.newline.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t").replace("\\e", "\e").replace("\\f", "\f").replace("\\0", "\0"); // jshint ignore:line
            }
            node.on("input", function(msg) {
                if (msg.hasOwnProperty("payload")) {
                    var payload = msg.payload;
                    if (!Buffer.isBuffer(payload)) {
                        if (typeof payload === "object") {
                            payload = JSON.stringify(payload);
                        } else {
                            payload = payload.toString();
                        }
                        payload += node.addCh;
                    } else if (node.addCh !== "") {
                        payload = Buffer.concat([payload, new Buffer(node.addCh)]);
                    }
                    node.port.write(payload, function(err, res) {
                        if (err) {
                            var errmsg = err.toString().replace("Serialport", "Serialport " + node.port.serial.path);
                            node.error(errmsg, msg);
                        }
                    });
                }
            });
            node.port.on('ready', function() {
                node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
            });
            node.port.on('closed', function() {
                node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
            });
        } else {
            this.error(RED._("serial.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                serialPool.close(this.serialConfig.serialport, done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("RS485 serial out", SerialOutNode);


    function SerialInNode(n) {
        RED.nodes.createNode(this, n);
        this.serial = n.serial;
        this.serialConfig = RED.nodes.getNode(this.serial);

        if (this.serialConfig) {
            var node = this;
            node.tout = null;
            var buf;
            if (node.serialConfig.out != "count") { buf = new Buffer(bufMaxSize); } else { buf = new Buffer(Number(node.serialConfig.newline)); }
            var i = 0;
            node.status({ fill: "grey", shape: "dot", text: "node-red:common.status.not-connected" });
            node.port = serialPool.get(this.serialConfig.serialport,
                this.serialConfig.serialbaud,
                this.serialConfig.databits,
                this.serialConfig.parity,
                this.serialConfig.stopbits,
                this.serialConfig.newline,
                this.serialConfig.flowcontrol
            );

            var splitc;
            if (node.serialConfig.newline.substr(0, 2) == "0x") {
                splitc = new Buffer([parseInt(node.serialConfig.newline)]);
            } else {
                splitc = new Buffer(node.serialConfig.newline.replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t").replace("\\e", "\e").replace("\\f", "\f").replace("\\0", "\0")); // jshint ignore:line
            }

            this.port.on('data', function(msg) {
                // single char buffer
                if ((node.serialConfig.newline === 0) || (node.serialConfig.newline === "")) {
                    if (node.serialConfig.bin !== "bin") { node.send({ "payload": String.fromCharCode(msg) }); } else { node.send({ "payload": new Buffer([msg]) }); }
                } else {
                    // do the timer thing
                    if (node.serialConfig.out === "time") {
                        if (node.tout) {
                            i += 1;
                            buf[i] = msg;
                        } else {
                            node.tout = setTimeout(function() {
                                node.tout = null;
                                var m = new Buffer(i + 1);
                                buf.copy(m, 0, 0, i + 1);
                                if (node.serialConfig.bin !== "bin") { m = m.toString(); }
                                node.send({ "payload": m });
                                m = null;
                            }, node.serialConfig.newline);
                            i = 0;
                            buf[0] = msg;
                        }
                    }
                    // count bytes into a buffer...
                    else if (node.serialConfig.out === "count") {
                        buf[i] = msg;
                        i += 1;
                        if (i >= parseInt(node.serialConfig.newline)) {
                            var m = new Buffer(i);
                            buf.copy(m, 0, 0, i);
                            if (node.serialConfig.bin !== "bin") { m = m.toString(); }
                            node.send({ "payload": m });
                            m = null;
                            i = 0;
                        }
                    }
                    // look to match char...
                    else if (node.serialConfig.out === "char") {
                        buf[i] = msg;
                        i += 1;
                        if ((msg === splitc[0]) || (i === bufMaxSize)) {
                            var n = new Buffer(i);
                            buf.copy(n, 0, 0, i);
                            if (node.serialConfig.bin !== "bin") { n = n.toString(); }
                            node.send({ "payload": n });
                            n = null;
                            i = 0;
                        }
                    }
                }
            });
            this.port.on('ready', function() {
                node.status({ fill: "green", shape: "dot", text: "node-red:common.status.connected" });
            });
            this.port.on('closed', function() {
                node.status({ fill: "red", shape: "ring", text: "node-red:common.status.not-connected" });
            });
        } else {
            this.error(RED._("serial.errors.missing-conf"));
        }

        this.on("close", function(done) {
            if (this.serialConfig) {
                serialPool.close(this.serialConfig.serialport, done);
            } else {
                done();
            }
        });
    }
    RED.nodes.registerType("RS485 serial in", SerialInNode);


    var serialPool = (function() {
        var connections = {};
        return {
            get: function(port, baud, databits, parity, stopbits, newline, flowcontrol, callback) {
                var id = port;
                if (!connections[id]) {
                    connections[id] = (function() {
                        var obj = {
                                _emitter: new events.EventEmitter(),
                                serial: null,
                                _closing: false,
                                tout: null,
                                on: function(a, b) { this._emitter.on(a, b); },
                                close: function(cb) { this.serial.close(cb); },
                                beginSend: function(cb) {
                                    var comport = this.serial;
                                    switch (flowcontrol) {
                                        case "rts-on":
                                            this.debug_log('Switch RTS-ON');
                                            comport.set({ "rts": true }, cb);
                                            break;
                                        case "rts-off":
                                            this.debug_log('Switch RTS-OFF');
                                            comport.set({ "rts": false }, cb);
                                            break;
                                        case "dtr-on":
                                            this.debug_log('Switch dtr-ON');
                                            comport.set({ "dtr": true }, cb);
                                            break;
                                        case "dtr-off":
                                            this.debug_log('Switch dtr-OFF');
                                            comport.set({ "dtr": false }, cb);
                                            break;
                                        default:
                                            if (cb)
                                                cb();
                                    }
                                },
                                endSend: function(cb) {
                                    var comport = this.serial;
                                    switch (flowcontrol) {
                                        case "rts-on":
                                            this.debug_log('Switch RTS-OFF');
                                            comport.set({ "rts": false }, cb);
                                            break;
                                        case "rts-off":
                                            this.debug_log('Switch RTS-ON');
                                            comport.set({ "rts": true }, cb);
                                            break;
                                        case "dtr-on":
                                            this.debug_log('Switch DTR-OFF');
                                            comport.set({ "dtr": false }, cb);
                                            break;
                                        case "dtr-off":
                                            this.debug_log('Switch DTR-ON');
                                            comport.set({ "dtr": true }, cb);
                                            break;
                                        default:
                                            if (cb)
                                                cb();
                                    }
                                },
                                debug_log: function(title, data) {
                                    console.log('[' + new Date().toJSON() + '] ', title, data);
                                },
                                write: function(m, cb) {
                                    var me = this;

                                    var lom = m.length;
                                    var msPerByte = 11 / baud;
                                    var msWait = lom * msPerByte * 1000;
                                    var comport = this.serial;

                                    me.beginSend(function() {
                                        me.debug_log('SEND', m);
                                        comport.write(m, function() {
                                            me.debug_log('WAIT ' + msWait + ' msec');
                                            setTimeout(function() {
                                                me.endSend(cb);
                                            }, msWait);
                                        });

                                    });

                                },
                            }
                            //newline = newline.replace("\\n","\n").replace("\\r","\r");
                        var olderr = "";
                        var setupSerial = function() {
                            obj.serial = new serialp(port, {
                                baudrate: baud,
                                databits: databits,
                                parity: parity,
                                stopbits: stopbits,
                                parser: serialp.parsers.raw,
                                autoOpen: true,
                                rtscts: false
                            }, function(err, results) {
                                if (err) {
                                    if (err.toString() !== olderr) {
                                        olderr = err.toString();
                                        RED.log.error(RED._("serial.errors.error", { port: port, error: olderr }));
                                    }
                                    obj.tout = setTimeout(function() {
                                        setupSerial();
                                    }, settings.serialReconnectTime);
                                }
                            });
                            obj.serial.on('error', function(err) {
                                RED.log.error(RED._("serial.errors.error", { port: port, error: err.toString() }));
                                obj._emitter.emit('closed');
                                obj.tout = setTimeout(function() {
                                    setupSerial();
                                }, settings.serialReconnectTime);
                            });
                            obj.serial.on('close', function() {
                                if (!obj._closing) {
                                    RED.log.error(RED._("serial.errors.unexpected-close", { port: port }));
                                    obj._emitter.emit('closed');
                                    obj.tout = setTimeout(function() {
                                        setupSerial();
                                    }, settings.serialReconnectTime);
                                }
                            });
                            obj.serial.on('open', function() {
                                obj.endSend();
                                olderr = "";
                                RED.log.info(RED._("serial.onopen", { port: port, baud: baud, config: databits + "" + parity.charAt(0).toUpperCase() + stopbits }));
                                if (obj.tout) { clearTimeout(obj.tout); }
                                //obj.serial.flush();
                                obj._emitter.emit('ready');
                            });
                            obj.serial.on('data', function(d) {
                                obj.debug_log('REC', d);
                                for (var z = 0; z < d.length; z++) {
                                    obj._emitter.emit('data', d[z]);
                                }
                            });
                            obj.serial.on("disconnect", function() {
                                RED.log.error(RED._("serial.errors.disconnected", { port: port }));
                            });
                        }
                        setupSerial();
                        return obj;
                    }());
                }
                return connections[id];
            },
            close: function(port, done) {
                if (connections[port]) {
                    if (connections[port].tout != null) {
                        clearTimeout(connections[port].tout);
                    }
                    connections[port]._closing = true;
                    try {
                        connections[port].close(function() {
                            RED.log.info(RED._("serial.errors.closed", { port: port }));
                            done();
                        });
                    } catch (err) {}
                    delete connections[port];
                } else {
                    done();
                }
            }
        }
    }());

    RED.httpAdmin.get("/serialports", RED.auth.needsPermission('serial.read'), function(req, res) {
        serialp.list(function(err, ports) {
            res.json(ports);
        });
    });
}