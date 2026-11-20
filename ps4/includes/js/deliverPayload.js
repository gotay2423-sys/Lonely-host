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
        xhr.timeout = 2000; // 2 second timeout
        
        xhr.onload = function () {
            if (xhr.status > 0) {
                log("Elfldr probe response: " + xhr.status + " " + xhr.statusText);
                resolve(true);
            } else {
                resolve(false);
            }
        };
        
        xhr.onerror = function () {
            log("Elfldr probe failed: " + xhr.status + " " + xhr.statusText);
            // Connection refused / unreachable means elfldr is not running
            resolve(false);
        };
        
        xhr.ontimeout = function () {
            log("Elfldr probe timed out");
            resolve(false);
        };
        
        try {
            xhr.send();

            log("[elfldr probe] ip: " + ps4Ip);
            log("[elfldr probe] URL: " + endpoint);
            log("[elfldr probe] Page: " + location.href);
            log("[elfldr probe] Origin: " + location.origin);
            return;
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
 *  - .bin: BinLoader on port 9020.
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

    // fetch payload binary and send via BinLoader port 9020
    var sendViaBinLoader = function (binPath, onComplete) {
        getPayload(binPath, function (fetchReq) {
            if (!fetchReq || (fetchReq.status !== 200 && fetchReq.status !== 304) || !fetchReq.response) {
                onComplete(false);
                return;
            }
            var targetPort = customPort || 9020;
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
        ps4Ip = (typeof user !== "undefined" && user.ip) ? user.ip : "127.0.0.1";
        ELFLDR = "http://" + ps4Ip + ":9021";

        var attempts = 0;
        var maxAttempts = 5;

        function trySendElf() {
            sendElfToElfldr(PLfile, name, function (success) {
                if (success) {
                    return;
                }
                attempts++;
                if (attempts < maxAttempts) {
                    log("Waiting for elfldr on port 9021 (attempt " + attempts + "/" + maxAttempts + ")...", "yellow");
                    setTimeout(trySendElf, 1000);
                } else {
                    if (id === "jailbreak") {
                        log("Could not reach elfldr on port 9021. Please restart console and try again.", "red");
                        return;
                    }
                    handleFallback();
                }
            });
        }

        trySendElf();
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

            var targetPort = customPort || 9020;
            var targetName = customPort ? window.lang.customPort : "BinLoader (9020)";
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
        storage.session.set("binloader", true);
        storage.session.remove("payload_path");
    } else {
        storage.session.set("payload_path", PLfile);
        storage.session.remove("binloader");
    }

    if (isPS4Console()) {
        location.reload();
    }
}

// Custom Uploaded Payload
function customPayload(payloadFile) {
    if (!payloadFile) {
        alert((window.lang && window.lang.emptyPayloadFile) || "Please select a payload file.");
        return;
    }
    var blobUrl = URL.createObjectURL(payloadFile);
    Loadpayloadlocal(blobUrl, payloadFile.name, 'custom');
    log(((window.lang && window.lang.customPayloadLoaded) || "Custom payload loaded: ") + payloadFile.name);
    setTimeout(function () {
        try { URL.revokeObjectURL(blobUrl); } catch (_) { }
    }, 30000);
}

function payloadRouter(payload) {
    if (!isPayloadSupported(payload)) {
        alert((window.lang && window.lang.unsupportedFirmware ? window.lang.unsupportedFirmware : "Unsupported firmware: ") + (user && user.ps4Fw ? user.ps4Fw : ""));
        return;
    }
    // If it's a BinLoader request
    if (payload.id === 'BinLoader' || (payload.src == undefined && payload.legacySrc == undefined)) {
        Loadpayloadonline(undefined);
    } else {
        var fwRaw = getPs4FwVersion() || (typeof user !== 'undefined' ? user.ps4Fw : null);
        var fwNum = (fwRaw !== null && fwRaw !== undefined) ? parseFloat(fwRaw) : NaN;
        var targetSrc = payload.src;

        if (!isNaN(fwNum) && fwNum <= 4.74 && payload.legacySrc !== undefined) {
            targetSrc = payload.legacySrc;
        } else if (targetSrc === undefined && payload.legacySrc !== undefined) {
            targetSrc = payload.legacySrc;
        }

        Loadpayloadlocal(targetSrc, payload.name, payload.id, payload.needsPayloadLoader);
        // install both base and update for psvue without mutating original payload object
        if (payload.id === 'PSVue' && typeof targetSrc === 'string') {
            var updateSrc = targetSrc.replace('base', '124');
            if (updateSrc !== targetSrc) {
                setTimeout(function () {
                    Loadpayloadlocal(updateSrc, payload.name + ' (Update)', payload.id, payload.needsPayloadLoader);
                }, 2500);
            }
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