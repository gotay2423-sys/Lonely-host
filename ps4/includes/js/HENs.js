var HEN_BASE_PATH = './includes/payloads/HEN/';
var DEFAULT_HEN   = "nexHEN";

function nexHEN() {
    storage.set('jailbreakFlavor', 'nexHEN');
    storage.session.set('payload_path', HEN_BASE_PATH + 'nexHEN-ps4.bin');
    user.currentJbFlavor = 'nexHEN';
}

function activateNexHEN(runNow) {
    nexHEN();
    if (typeof log === 'function') {
        log('nexHEN selected: ' + HEN_BASE_PATH + 'nexHEN-ps4.bin', 'green');
    }
    if (runNow) {
        jailbreak();
    }
}

function GoldHEN() {
    nexHEN();
}

function PS4HEN() {
    nexHEN();
}

function chooseHEN() {
    nexHEN();
}

function setGoldHENVer(value) {
    // Deprecated - nexHEN is the exclusive payload
}

function loadGoldHENVer() {
    // Deprecated - nexHEN is the exclusive payload
}

function saveJbFlavor(name, value) {
    nexHEN();
}

function loadJbFlavor() {
    nexHEN();
}

function updateHenFlavorVisibility(fwVersion) {
    var nexHENInputInitial = document.getElementById('nexHEN-btn-initial') || document.getElementById('nexHEN-label-initial');
    var nexHENInputExploit = document.getElementById('nexHEN-label-exploit');
    if (nexHENInputInitial) toggleVisibility(nexHENInputInitial.id, true);
    if (nexHENInputExploit) toggleVisibility(nexHENInputExploit.id, true);
}
