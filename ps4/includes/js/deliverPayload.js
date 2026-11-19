// @ts-nocheck

var ELFLDR = 'http://127.0.0.1:9021';

var needsPayloadLoader = false;

/**
 * POSTs raw ELF bytes directly to elfldr.
 */
function sendPayload(bytes, name, onDone, args) {
    var endpoint = ELFLDR;
    var payloadName = name || 'payload.elf';
    var query = '?pipe=0' + (args ? '&args=' + encodeURIComponent(args) : '');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint + '/' + encodeURIComponent(payloadName) + query);
    xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.onload = function () { if (onDone) onDone(xhr.status, xhr.responseText); };
    xhr.onerror = function () { if (onDone) onDone(0, 'request failed'); };
    var data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    xhr.send(data);
}

/**
 * Fetches a payload from url then POSTs its bytes to elfldr via sendPayload.
 */
function loadAndSend(url, onDone, name, args) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function () {
        if (xhr.status === 200 || xhr.status === 304) {
            // Updated to use getPayloadName
            var payloadName = name || (url.indexOf("blob:") === 0 ? "payload.elf" : getPayloadName(url));
            sendPayload(xhr.response, payloadName, onDone, args);
        } else {
            if (onDone) onDone(xhr.status, 'could not load ' + url);
        }
    };
    xhr.onerror = function () { if (onDone) onDone(0, 'could not load ' + url); };
    xhr.send();
}

/**
 * A legacy friendly way to get the payload name from a URL.
 */
function getPayloadName(url) {
    var dynamicName = "payload.elf";
    if (url) {
        var parts = url.split("/");
        var lastPart = parts[parts.length - 1];
        if (lastPart) {
            var cleanName = lastPart.split("?")[0];
            if (cleanName) {
                dynamicName = cleanName;
            }
        }
    }

    return dynamicName;
}

/**
 * sends an ELF to elfldr using the POST binary stream method.
 */
function sendElfToElfldr(url, payloadName, onDone, args) {
    var fileName = payloadName || getPayloadName(url);

    loadAndSend(url, function (status, responseText) {
        var ok = (status === 200 || status === 202);
        if (ok) {
            var msg = (window.lang.elfLoaderResponse ||
                "Payload sent successfully through the Elf Loader!\nStatus: {status} {statusText}\nResponse: {body}")
                .replace("{status}", status)
                .replace("{statusText}", "OK")
                .replace("{body}", responseText || "");
            log(msg, "green");
        }
        if (onDone) onDone(ok, responseText);
    }, fileName, args);
}

/**
 * Returns true if the payload path contains an elf extension.
 */
function isPayloadElf(path) {
    return path.indexOf('.elf') !== -1;
}

/**
 * probes if elfldr is actively listening on port 9021.
 */
function probeElfLoader() {
    return new Promise(function (resolve) {
        var ps4Ip = (typeof user !== "undefined" && user.ip) ? user.ip : "127.0.0.1";
        var endpoint = "http://" + ps4Ip + ":9021/";
        
        var xhr = new XMLHttpRequest();
        xhr.open("GET", endpoint, true);
        xhr.timeout = 1000;
        
        xhr.onload = function () {
            resolve(true);
        };
        xhr.onerror = function () {
            resolve(false);
        };
        xhr.ontimeout = function () {
            resolve(false);
        };
        try {
            xhr.send();
        } catch (e) {
            resolve(false);
        }
    });
}

function getPayload(payloadUrl, onLoadEndCallback) {
    var req = new XMLHttpRequest();
    req.open("GET", payloadUrl);
    req.responseType = "arraybuffer";
    req.onload = function (event) {
        if (onLoadEndCallback) onLoadEndCallback(req, event);
    };
    req.onerror = function (event) {
        if (onLoadEndCallback) onLoadEndCallback(req, event);
    };
    req.send();
}

function sendPayloadWithTimeout(url, data, timeoutMs, onResult) {
    var req = new XMLHttpRequest();
    var finished = false;
    var timer = null;

    function complete(success) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        onResult(success, req);
    }

    timer = setTimeout(function () {
        complete(false);
    }, timeoutMs || 8000);

    req.onload = function () {
        if (req.status === 200 || req.status == 202) {
            complete(true);
        } else {
            log(window.lang.httpStatus.replace("{status}", req.status), "red");
            log(window.lang.responseBody.replace("{body}", req.responseText), "red");
            complete(false);
        }
    };

    req.onerror = function () {
        complete(false);
    };

    try {
        req.open("POST", url, true);
        req.send(data);
    } catch (e) {
        complete(false);
    }
}

/**
 * Sends a payload to the PS4.
 *  - .elf: elfldr on port 9021 (POST binary upload)
 *            If elfldr isn't running yet, boots it first via GoldHEN (port 9090).
 *  - .bin: GoldHEN / nexHEN binloader on port 9090.
 */
function Loadpayloadlocal(PLfile, name, id, needsPayloadLoader, customPort) {
    var ps4Ip = (typeof user !== "undefined" && user.ip) ? user.ip : "127.0.0.1";
    ELFLDR = "http://" + ps4Ip + ":9021";

    var handleFallback = function () {
        if (id === "ElfLoader") {
            PLfile = "./includes/payloads/Bins/elfldr.bin";
        }
        if (isFirmwareSupported(user.ps4Fw)) {
            if (!isHttps()) {
                if (requiresPayloadServer(needsPayloadLoader)) {
                    return;
                }
                if (id == "jailbreak") {
                    log("Failed to load with jailbreak id", 'orange');
                    return; 
                }
                if (confirm(window.lang.disabledBinloader)) {
                    Loadpayloadonline(PLfile);
                }
            } else {
                Loadpayloadonline(PLfile);
            }
        } else {
            alert(window.lang.binLoaderNotDetected);
        }
    };

    // fetch payload binary and send via GoldHEN port 9090
    var sendViaBinLoader = function (binPath, onComplete) {
        getPayload(binPath, function (fetchReq) {
            if (!fetchReq || (fetchReq.status !== 200 && fetchReq.status !== 304) || !fetchReq.response) {
                onComplete(false);
                return;
            }
            var targetPort = customPort || 9090;
            var targetUrl = "http://" + ps4Ip + ":" + targetPort + "/";
            sendPayloadWithTimeout(targetUrl, fetchReq.response, 5000, function (success) {
                onComplete(success);
            });
        });
    };

    var resolvedName = name || getPayloadName(PLfile);

    var cleanPath = (PLfile || "").split('?')[0].split('#')[0].toLowerCase();
    var isElf = cleanPath.indexOf(".elf") !== -1 ||
        (resolvedName && resolvedName.toLowerCase().endsWith(".elf"));

    if (isElf && cleanPath.indexOf('linux') == -1) {
        var attempts = 0;
        var maxAttempts = 5;

        var dispatchElf = function () {
            sendElfToElfldr(PLfile, resolvedName, function (success, resp) {
                if (success) {
                    if (id === 'jailbreak') {
                        log("nexHEN loaded successfully!", "green");
                        if (typeof jailbreakSuccess === "function") {
                            jailbreakSuccess();
                        }
                    }
                    return;
                }

                attempts++;
                if (attempts < maxAttempts) {
                    log("Retrying elfldr on port 9021 (" + attempts + "/" + maxAttempts + ")...", "yellow");
                    setTimeout(dispatchElf, 1000);
                } else {
                    log("Failed to connect to elfldr on port 9021", "red");
                    if (id !== "jailbreak") {
                        handleFallback();
                    }
                }
            });
        };

        dispatchElf();
    } else {
        getPayload(PLfile, function (fetchReq) {
            if (fetchReq && fetchReq.status === 404) {
                log(window.lang.payloadNotFound.replace("{payload}", name) + PLfile, "red");
                return;
            }

            if (!fetchReq || (fetchReq.status !== 200 && fetchReq.status !== 304) || !fetchReq.response) {
                handleFallback();
                return;
            }

            log(window.lang.payloadLoaderSending.replace("{payload}", name));

            var targetPort = customPort || 9090;
            var targetName = customPort ? window.lang.customPort : "nexHEN";
            var targetUrl = "http://" + ps4Ip + ":" + targetPort + "/";

            sendPayloadWithTimeout(targetUrl, fetchReq.response, 5000, function (success) {
                if (success) {
                    var msg = window.lang.payloadLoaderSendSuccess.replace("{payload}", name) +
                        ps4Ip + " (" + targetName + ")";
                    log(msg);
                    if (getPs4FwVersion() == 4.74) log(window.lang.firmwareNotificationsUnavailable, "grey");
                } else {
                    var errorMsg = window.lang.payloadLoaderSendFailed.replace("{payload}", name) + ps4Ip;
                    log(errorMsg, "red");
                    if (requiresPayloadServer(needsPayloadLoader)) {
                        return;
                    }
                    setTimeout(function () {
                        handleFallback();
                    }, 500);
                }
            });
        });
    }
}

/**
 * Loads a payload directly via WebKit exploit / session storage.
 */
function Loadpayloadonline(PLfile) {
    if (PLfile == undefined || PLfile == null) {
        // Run BinLoader
        storage.session.set("binloader", 1);
    } else {
        storage.session.set("payload_path", PLfile);
    }

    if (isPS4Console()) {
        jailbreak();
    }
}

// Custom Uploaded Payload
function customPayload(payloadFile) {
    if (!payloadFile) {
        alert(window.lang.emptyPayloadFile);
        return;
    }
    Loadpayloadlocal(URL.createObjectURL(payloadFile), payloadFile.name, payloadFile.id);
    log(window.lang.customPayloadLoaded + payloadFile.name);
}

function payloadRouter(payload) {
    if (!isPayloadSupported(payload)) {
        alert(window.lang.unsupportedFirmware + user.ps4Fw);
        return;
    }
    // If it's a HEN payload, run jailbreak directly with nexHEN
    if (payload.id === 'nexHEN' || payload.id === 'GoldHEN' || payload.id === 'PS4HEN') {
        storage.set('jailbreakFlavor', 'nexHEN');
        storage.session.set('payload_path', './includes/payloads/HEN/nexHEN-ps4.elf');
        user.currentJbFlavor = 'nexHEN';
        jailbreak();
        return;
    }
    // It's a BinLoader
    if (payload.src == undefined && payload.legacySrc == undefined) {
        Loadpayloadonline(undefined);
    } else {
        // check for firmware to load a legacy payload instead
        if (getPs4FwVersion() <= 4.74 && payload.legacySrc != undefined) {
            payload.src = payload.legacySrc;
        }

        Loadpayloadlocal(payload.src, payload.name, payload.id, payload.needsPayloadLoader);
        // install both base and update for psvue
        if (payload.id == 'PSVue') {
            payload.src = payload.src.replace('base', '124');
            Loadpayloadlocal(payload.src, payload.name, payload.id, payload.needsPayloadLoader);
        }
    }
}

function requiresPayloadServer(needsPayloadLoader) {
    if (needsPayloadLoader) {
        alert(window.lang.binLoaderNotDetected + "\n\n" + window.lang.payloadRequiresPayloadLoader);
        return true;
    }
    return false;
}