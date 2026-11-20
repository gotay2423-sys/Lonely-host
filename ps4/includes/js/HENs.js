// Pure BinLoader mode - nexHEN and GoldHEN completely eliminated

function BinLoader() {
    storage.set('jailbreakFlavor', 'BinLoader');
    storage.session.remove('payload_path');
    storage.session.set('binloader', true);
    if (typeof user !== 'undefined') user.currentJbFlavor = 'BinLoader';
}

function activateBinLoader(runNow) {
    if (runNow && typeof user !== 'undefined' && user.blockJailbreak) return;
    BinLoader();
    if (typeof log === 'function') {
        log('BinLoader selected (Port 9020)', 'green');
    }
    if (runNow) {
        if (typeof user !== 'undefined') user.blockJailbreak = true;
        jailbreak();
    }
}

// Compatibility stubs routing all legacy HEN references to BinLoader
function nexHEN() { BinLoader(); }
function activateNexHEN(runNow) { activateBinLoader(runNow); }
function GoldHEN() { BinLoader(); }
function PS4HEN() { BinLoader(); }
function chooseHEN() { BinLoader(); }
function setGoldHENVer(value) {}
function loadGoldHENVer() {}
function saveJbFlavor(name, value) { BinLoader(); }
function loadJbFlavor() { BinLoader(); }

function updateHenFlavorVisibility(fwVersion) {
    var bldrInputInitial = document.getElementById('nexHEN-btn-initial') || document.getElementById('binloader-btn-initial');
    var bldrInputExploit = document.getElementById('nexHEN-label-exploit') || document.getElementById('binloader-label-exploit');
    if (bldrInputInitial) toggleVisibility(bldrInputInitial.id, true);
    if (bldrInputExploit) toggleVisibility(bldrInputExploit.id, true);
}
