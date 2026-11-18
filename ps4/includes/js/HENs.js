var HEN_BASE_PATH = './includes/payloads/HEN/';
var DEFAULT_HEN   = "nexHEN";

function nexHEN() {
    storage.session.set('payload_path', HEN_BASE_PATH + 'nexHEN-ps4.bin');
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
    storage.set('jailbreakFlavor', 'nexHEN');
    user.currentJbFlavor = 'nexHEN';
    nexHEN();
}

function loadJbFlavor() {
    storage.set('jailbreakFlavor', 'nexHEN');
    user.currentJbFlavor = 'nexHEN';
    nexHEN();
}

function updateHenFlavorVisibility(fwVersion) {
    var nexHENInputInitial = document.getElementById('nexHEN-label-initial');
    var nexHENInputExploit = document.getElementById('nexHEN-label-exploit');
    if (nexHENInputInitial) toggleVisibility(nexHENInputInitial.id, true);
    if (nexHENInputExploit) toggleVisibility(nexHENInputExploit.id, true);
}