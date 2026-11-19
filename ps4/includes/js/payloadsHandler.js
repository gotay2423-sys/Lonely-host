// Handles payload tab loading, rendering, and dispatching.
// payloads tabs
function loadLastTab() {
    if (user.lastTab == "advanced" && !user.advancedPayloads) {
        // set last tab to tools
        user.lastTab = "tools";
        if (ui.toolsSection) ui.toolsSection.click();
    }
    var targetEl = document.getElementById(user.lastTab);
    if (targetEl) toggleVisibility(targetEl.id, 1);
    var tabEl = document.getElementById(user.lastTab + '-tab');
    if (tabEl) tabEl.setAttribute("aria-selected", "true");
}

function saveLastTab(tab) {
    // Update state
    user.lastTab = tab;
    storage.set('lastTab', tab);

    // Define the map of containers
    var sections = {
        'tools': ui.toolsSection,
        'homebrew': ui.homebrewSection,
        'linux': ui.linuxSection,
        'advanced': ui.advancedPayloadsSection,
        'custom': ui.customPayloadsSection
    };

    // Nuke contents of every section but the active one and custom to free memory
    for (var key in sections) {
        if (sections.hasOwnProperty(key)) {
            if (key !== tab && sections[key] && key !== 'custom') {
                sections[key].innerHTML = '';
            }
        }
    }
}

function Loadpayloads(payload) {
    if (payload.id == "FanThreshold") {
        chooseFanThreshold();
        return;
    }
    if (!isPS4Console()) {
        var inputIp = ui.ps4IpInput ? ui.ps4IpInput.value.trim() : "";
        if (!inputIp || /\s/.test(inputIp)) {
            alert(window.lang.ps4IpInvalid);
            return;
        }

        if (user.ps4Fw == null || user.ps4Fw == 'undefined') {
            if (ui.ps4FwSelect) ui.ps4FwSelect.style.border = "2px solid red";
            return;
        }
        user.ip = inputIp;
    }
    try {
        storage.session.remove('binloader');
        
        if (payload.id == undefined) {
            var payloadFile = ui.customPayloadInput ? ui.customPayloadInput.files[0] : null;
            if (!payloadFile) return;
            customPayload(payloadFile);
        } else {
            payloadRouter(payload);
        }

    } catch (e) {
        alert('Failed to load payload: ' + payload.name + ' | Error: ' + e);
    }
}

function loadFanThreshold(temperature) {
    var supportedTemperatures = {
        "60": true,
        "70": true,
        "80": true,
        "85": true
    };

    if (!Object.prototype.hasOwnProperty.call(supportedTemperatures, temperature)) {
        alert('Invalid fan threshold selection.');
        return;
    }

    toggleVisibility(ui.chooseFanThresholdOverlay.id, false);
    Loadpayloads({
        id: 'FanThreshold' + temperature,
        name: 'Fan Threshold (' + temperature + '°C)',
        specificFW: '4.73 - latest',
        src: payloadsPath + 'fan-thresholds/ps4-fan-threshold' + temperature + '.bin'
    });
}

function renderPayloads(payloads) {
    if (!payloads || !payloads.length) return;

    // Identify the target container
    var firstCategory = payloads[0].category;
    var targetContainer;

    if (firstCategory === 'tools') targetContainer = ui.toolsSection;
    else if (firstCategory === 'homebrew') targetContainer = ui.homebrewSection;
    else if (firstCategory === 'linux') targetContainer = ui.linuxSection;
    else if (firstCategory === 'advanced') targetContainer = ui.advancedPayloadsSection;

    // Clear previous elements to avoid duplication
    if (targetContainer) targetContainer.innerHTML = '';

    for (var i = 0; i < payloads.length; i++) {
        (function (payload) {
            // hide unsupported payloads
            if (hideUnsupportedPayloads) {
                if (typeof user !== 'undefined' && user.ps4Fw) {
                    if (!isPayloadSupported(payload)) {
                        console.log(payload.name + " is not supported on firmware " + user.ps4Fw)
                        return; // Skip rendering this card
                    }
                }
            }

            var payloadCard = document.createElement('div');
            payloadCard.id = payload.id;
            payloadCard.onclick = function () {
                Loadpayloads(payload);
            };
            var isFeatured = payload.name && (payload.name.indexOf('nexHEN') !== -1 || payload.name.indexOf('HEN') !== -1);
            payloadCard.className = 'payload payload-card' + (isFeatured ? ' card-featured' : '');
            payloadCard.dataset.payloadId = payload.id;

            var specificFwHtml = payload.specificFW ? '<span style="color: #f59e0b; font-size: 10px; margin-left: 6px;">(' + payload.specificFW + ')</span>' : '';

            payloadCard.innerHTML =
                '<div class="p-info">' +
                '<div class="p-name">' + payload.name + specificFwHtml + '</div>' +
                '<div class="p-desc" title="' + (payload.description || payload.author || '') + '">' + (payload.description || payload.author || '') + '</div>' +
                '</div>' +
                '<button type="button" class="btn-send' + (isFeatured ? ' btn-featured' : '') + '">LOAD</button>';

            switch (payload.category) {
                case "tools":
                    if (ui.toolsSection) ui.toolsSection.appendChild(payloadCard);
                    break;
                case "homebrew":
                    if (ui.homebrewSection) ui.homebrewSection.appendChild(payloadCard);
                    break;
                case "linux":
                    if (ui.linuxSection) ui.linuxSection.appendChild(payloadCard);
                    break;
                case "advanced":
                    if (ui.advancedPayloadsSection) ui.advancedPayloadsSection.appendChild(payloadCard);
                    break;
                default:
                    if (ui.toolsSection) ui.toolsSection.appendChild(payloadCard);
                    break;
            }
        })(payloads[i]);
    }
}

function loadAdvancedPayloads() {
    if (user.advancedPayloads) {
        // its true, check the box, show tab and load the payloads
        if (ui.advancedPayloadsInput) ui.advancedPayloadsInput.checked = true;
        if (ui.advancedPayloadsContainer) toggleVisibility(ui.advancedPayloadsContainer.id, 1);
        var advancedPayloads = [];
        if (typeof payloadsList !== 'undefined') {
            for (var i = 0; i < payloadsList.length; i++) {
                if (payloadsList[i].category === 'advanced') {
                    advancedPayloads.push(payloadsList[i]);
                }
            }
        }
        renderPayloads(advancedPayloads);
    }
}

function getPayloadCategoryClass(category) {
    switch (category) {
        case 'tools': return 'category-tools';
        case 'homebrew': return 'category-homebrew';
        case 'linux': return 'category-linux';
        case 'advanced': return 'category-advanced';
        default: return '';
    }
}

/**
 * Checks if userFW is supported according to payload.specificFW string.
 * Works with rules like: "5.05, 7.00 - 8.50, 9.00 - latest"
 */
function isPayloadSupported(payload) {
    var userFW = parseFloat(getPs4FwVersion() || user.ps4Fw);
    if (!userFW) return false;

    // If payload has explicit specificFW string
    if (payload.specificFW.trim() == "") return true;
    // Replace 'latest' with max firmware supported
    var rawStr = payload.specificFW.replace(/latest/gi, commonMax);
    var rules = rawStr.split(',');

    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i].trim();

        if (rule.indexOf('-') !== -1) {
            // Range: "9.00 - 14.00"
            var parts = rule.split('-');
            var minVal = parseFloat(parts[0]);
            var maxVal = parseFloat(parts[1]);

            if (userFW >= minVal && userFW <= maxVal) {
                return true;
            }
        } else {
            // Single match: "5.05"
            if (userFW == parseFloat(rule)) {
                return true;
            }
        }
    }
    return false;
}