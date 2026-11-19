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

// Auto-display detected firmware on load
if (fwText) {
  fwText.textContent = window.fw_str ? window.fw_str : "7.00 – 13.60";
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
  output.scrollTop = output.scrollHeight;
}

function writeEvent(name, detail, type) {
  writeLog(detail == null || detail === "" ? name : `${name}: ${detail}`,
    type || (name === "Failed" ? "error" : "log"));
}

window.writeLog = writeLog;
window.jb = { mark: writeEvent };

/* ---------- Pre-Flight ELF Loader Probing ---------- */
async function probeElfLoader() {
  // 1. If hosted with local server (serve.py), probe the server's API
  try {
    const probeReq = await fetch("/api/probe", { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (probeReq.ok) {
      const data = await probeReq.json();
      if (data.online) {
        updateElfldrStatus(true);
        return { online: true };
      }
    }
  } catch (_) {
    // Local API not present or not running locally
  }

  // 2. If running on public host (e.g. GitHub Pages), verify via ROP socket
  const rop = window.ropRuntime;
  if (!rop || !rop.chain || !rop.p) {
    updateElfldrStatus(false);
    return { online: false, reason: "Kernel exploit has not been run yet. Click RUN EXPLOIT first." };
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

  const primitive = await getPrimitive();
  writeLog(`WebKit base: 0x${getWebKitBase().toString(16)}`, "info");

  setStatus("STAGE 2: KERNEL", "running");
  await import("./relapse_exploit.js");
  await main(primitive);

  setStatus("JAILBROKEN", "success");
  updateElfldrStatus(true);
  if (runBtn) {
    runBtn.textContent = "JAILBROKEN ✓";
    runBtn.classList.add("btn-success");
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

  // Pre-flight check: is port 9021 active?
  const probe = await probeElfLoader();
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
        btn.textContent = "SENT ✓";
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
        const cache = await caches.open("lonely-ps5-v2");
        const urlsToCache = [
          "./",
          "./index.html",
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

initOfflineCache();
