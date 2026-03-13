"use strict";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEV = false;

function log(...data) {
  if (DEV) {
    console.log(...data);
  }
}

function debug(...data) {
  if (DEV) {
    console.debug(...data);
  }
}

const MIN_REPORT_INTERVAL = 5 * 1000; // ms

const SERVER_ORIGIN =
  window.location.origin !== "null" ? window.location.origin : "";

const WATCHED_JOBS = [
  "P.I.G.S. Robberrery",
  "EMS / Paramedic",
  "Firefighter",
  "CollinsCo Cabbies",
  "R.T.S. Aviator",
  "R.T.S. Professional",
  "R.T.S. Transporter",
];

const WATCHED_KEYS = ["user_id", "job_name"];

const SERVERS = [
  {
    proxy: "https://tycoon-2epova.users.cfx.re/status/",
    backup: "https://tt-proxy.thisisaproxy.workers.dev/main/status/",
  },
  {
    proxy: "https://tycoon-njyvop.users.cfx.re/status/",
    backup: "https://tt-proxy.thisisaproxy.workers.dev/beta/status/",
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  user_id: null,
  name: null,
  job: null,
  streaks: {},
  pending_report: false,
  lastStatus: "Waiting…",
  statusType: "neutral",
  lastReportPayload: null,
  lastReportTime: 0,
};

// ---------------------------------------------------------------------------
// Draging Logic
// ---------------------------------------------------------------------------

// Shared interaction state for drag & resize (uses the same mousemove/mouseup)
let listenersAttached = false;
// Used to track last sent streaks for change detection
let lastSentStreaks = null;
let isDragging = false;
let isResizing = false;
let startX = 0;
let startY = 0;
let originX = 0;
let originY = 0;
let originWidth = 0;

function initializeDragging() {
  const tracker = document.getElementById("tracker");
  const header = tracker ? tracker.querySelector(".header") : null;
  const handle = document.getElementById("resize-handle");

  if (!tracker || !header) return;

  const savedPosition = getSavedPosition();
  if (savedPosition) {
    tracker.style.left = Math.round(savedPosition.x) + "px";
    tracker.style.top = Math.round(savedPosition.y) + "px";
  }

  header.style.cursor = "move";

  if (!listenersAttached) {
    header.addEventListener("mousedown", startDragging);
    if (handle) handle.addEventListener("mousedown", startResizing);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    listenersAttached = true;
  }
}

function startDragging(e) {
  isDragging = true;
  const tracker = document.getElementById("tracker");
  startX = e.clientX;
  startY = e.clientY;
  const rect = tracker.getBoundingClientRect();
  originX = Math.round(rect.left);
  originY = Math.round(rect.top);
  e.preventDefault();
}

function startResizing(e) {
  isResizing = true;
  const tracker = document.getElementById("tracker");
  startX = e.clientX;
  originWidth = tracker.offsetWidth;
  e.preventDefault();
  e.stopPropagation();
}

function onMouseMove(e) {
  const tracker = document.getElementById("tracker");

  if (isDragging) {
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const maxX = window.innerWidth - tracker.offsetWidth;
    const maxY = window.innerHeight - tracker.offsetHeight;
    tracker.style.left =
      Math.round(Math.max(0, Math.min(originX + deltaX, maxX))) + "px";
    tracker.style.top =
      Math.round(Math.max(0, Math.min(originY + deltaY, maxY))) + "px";
    return;
  }

  if (isResizing) {
    const delta = e.clientX - startX;
    const newWidth = Math.max(MIN_WIDTH, originWidth + delta);
    tracker.style.width = newWidth + "px";
    applyScale(newWidth);
    return;
  }
}

function onMouseUp() {
  if (isDragging) {
    isDragging = false;
    savePosition();
  }
  if (isResizing) {
    isResizing = false;
    const tracker = document.getElementById("tracker");
    localStorage.setItem(
      "StreakTracker_width",
      Math.round(tracker.offsetWidth),
    );
  }
}

function savePosition() {
  const tracker = document.getElementById("tracker");
  const rect = tracker.getBoundingClientRect();

  const position = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
  };

  localStorage.setItem("StreakTracker_position", JSON.stringify(position));
}

function getSavedPosition() {
  try {
    const saved = localStorage.getItem("StreakTracker_position");
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resize scaling – keeps every element proportional to the panel width
// ---------------------------------------------------------------------------

const BASE_WIDTH = 240;
const MIN_WIDTH = 140;

function applyScale(width) {
  const scale = width / BASE_WIDTH;
  document.documentElement.style.setProperty("--scale", scale.toFixed(4));
}

function initializeResize() {
  const tracker = document.getElementById("tracker");
  if (!tracker) return;

  // Restore saved width
  const savedWidth = localStorage.getItem("StreakTracker_width");
  if (savedWidth) {
    tracker.style.width = savedWidth + "px";
    applyScale(Number(savedWidth));
  }
}
// ---------------------------------------------------------------------------
// Message parsing – extract game data into local state
// ---------------------------------------------------------------------------

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DATA_HANDLERS = {
  user_id: (v) => {
    const wasEmpty = !state.user_id;
    state.user_id = v;
    if (wasEmpty && v) fetchUserData();
  },
  name: (v) => {
    state.name = v;
  },
  job_name: (v) => {
    state.job = v;
  },
};

function handleMessage(event) {
  const msg = event.data;
  if (typeof msg !== "object" || msg === null) return;
  debug("Received message:", msg);
  const data = msg.data;
  if (!isObject(data)) return;

  for (const key of WATCHED_KEYS) {
    if (!(key in data)) continue;

    if (!(key in DATA_HANDLERS)) {
      console.warn(`No handler for key: ${key}`);
      continue;
    }
    log(`Handling key: ${key} with value: ${data[key]}`);
    const handler = DATA_HANDLERS[key];
    const value = data[key];
    try {
      handler(value);
    } catch (err) {
      console.error(`Error handling key: ${key}`, err);
    }
  }

  renderUI();
}

window.addEventListener("message", handleMessage);

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function buildReportPayload() {
  // Report each streak as a separate event
  const user_id = state.user_id;
  if (!user_id || typeof user_id !== "number" || !Number.isInteger(user_id))
    return null;
  const now = new Date();
  const streaks = state.streaks || {};
  // Only report nonzero streaks
  const events = Object.entries(streaks)
    .filter(([name, v]) => v && v.current && Number.isInteger(v.current))
    .map(([name, v]) => ({
      user_id,
      streak_name: name,
      streak_value: v.current,
      timestamp: now.toISOString(),
    }));
  return events.length > 0 ? events : null;
}

async function reportStreaks() {
  debug("[StreakTracker] reportStreaks called");
  if (!isTelemetryEnabled()) return;

  const payloads = buildReportPayload();
  if (!payloads) return;
  // Avoid duplicate reports
  const payloadStr = JSON.stringify(payloads);
  if (
    payloadStr === state.lastReportPayload &&
    Date.now() - state.lastReportTime < MIN_REPORT_INTERVAL
  )
    return;
  state.lastReportPayload = payloadStr;
  state.lastReportTime = Date.now();

  for (const payload of payloads) {
    try {
      const res = await fetch("/api/streak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setStatus("Report failed", "error");
        console.warn("Failed to report streak:", await res.text());
      } else {
        setStatus("Reported", "ok");
      }
    } catch (err) {
      setStatus("Report error", "error");
      console.error("Error reporting streak:", err);
    }
  }
}

function maybeReportStreaks() {
  debug("[StreakTracker] maybeReportStreaks called");
  // Only send if streaks changed
  const currentStreaks = JSON.stringify(state.streaks);
  if (lastSentStreaks === currentStreaks) {
    debug("[StreakTracker] Streaks unchanged, not reporting");
    return;
  }
  lastSentStreaks = currentStreaks;
  if (!isTelemetryEnabled()) {
    debug("[StreakTracker] Telemetry disabled, not reporting");
    return;
  }
  // Only report if enough time has passed
  if (Date.now() - state.lastReportTime < MIN_REPORT_INTERVAL) {
    debug("[StreakTracker] Rate limit, not reporting");
    return;
  }
  reportStreaks();
}

// ---------------------------------------------------------------------------
// API Response Parsing
// ---------------------------------------------------------------------------

async function fetchWithTimeout(resource, options = {}, timeout = 5000) {
  debug(`Fetching ${resource} with timeout ${timeout}ms`);
  return Promise.race([
    fetch(resource, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), timeout),
    ),
  ]);
}

async function fetchUserData() {
  if (!state.user_id) return;
  const privateKey = getPrivateKey();
  if (!privateKey) return;

  const endpoints = [
    SERVERS[0].proxy + "data/" + encodeURIComponent(state.user_id),
    SERVERS[0].backup + "data/" + encodeURIComponent(state.user_id),
    SERVERS[1].proxy + "data/" + encodeURIComponent(state.user_id),
    SERVERS[1].backup + "data/" + encodeURIComponent(state.user_id),
  ];

  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            "x-tycoon-key": privateKey,
          },
        },
        5000,
      );
      if (!res.ok) throw new Error("API error " + res.status);
      const data = await res.json();
      setStatus("OK", "ok");
      // Handle streaks
      if (data && data.data && data.data.streaks) {
        const newStreaks = {};
        for (const [key, value] of Object.entries(data.data.streaks)) {
          debug(
            `Streak ${key}: current=${value.current}, record=${value.record}`,
          );
          if (
            (value.current && value.current !== 0) ||
            (value.record && value.record !== 0)
          ) {
            const name = key.replace(/_/g, " ").trim();
            newStreaks[name] = value;
          }
        }
        // Only update and report if changed
        if (JSON.stringify(state.streaks) !== JSON.stringify(newStreaks)) {
          state.streaks = newStreaks;
          maybeReportStreaks();
        } else {
          debug(
            "[StreakTracker] Streaks unchanged, not updating/reporting",
          );
        }
      } else {
        debug("No streaks data found in response");
      }
      renderUI();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  setStatus("Failed to load data");
  if (lastError) console.error("All endpoints failed:", lastError);
  renderUI();
}

function setStatus(msg, type = "error") {
  state.lastStatus = msg;
  state.statusType = type;
}

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function getTextBindings() {
  return {
    "player-name": state.name || "--",
    "user-id": state.user_id || "--",
    "last-report": state.lastReportTime
      ? new Date(state.lastReportTime).toLocaleTimeString()
      : "Never",
    "report-status": state.lastStatus || "Waiting…",
  };
}

function renderUI() {
  // Job badge
  const badge = document.getElementById("job-badge");
  const job = state.job;
  if (badge) {
    badge.textContent = job || "--";
    badge.className =
      "badge " +
      (job && WATCHED_JOBS.includes(job) ? "badge-active" : "badge-inactive");
  }

  // Simple text bindings
  for (const [id, value] of Object.entries(getTextBindings())) {
    setText(id, value);
  }

  // Status (footer row)
  const statusEl = document.getElementById("report-status");
  if (statusEl) {
    statusEl.textContent = state.lastStatus;
    statusEl.className =
      "value muted" +
      (state.statusType === "error" ? " status-error" : "") +
      (state.statusType === "ok" ? " status-ok" : "");
  }

  // Streaks
  renderStreaks();
}

function renderStreaks() {
  const container = document.getElementById("streaks-list");
  if (!container) return;
  container.innerHTML = "";
  const streaks = state.streaks || {};
  const entries = Object.entries(streaks)
    .filter(([, v]) => v.current && v.current !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    container.innerHTML =
      '<div class="streaks-empty">No streaks to display.</div>';
    return;
  }
  for (const [key, value] of entries) {
    const label = key.trim();
    const current = value.current;
    const record = value.record || 0;
    const el = document.createElement("div");
    el.className = "streak-row";
    el.textContent = `${label}: ${current} (${record})`;
    container.appendChild(el);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------

function getPrivateKey() {
  try {
    return localStorage.getItem("StreakTracker_private_key") || "";
  } catch {
    return "";
  }
}

function setPrivateKey(value) {
  try {
    localStorage.setItem("StreakTracker_private_key", value.trim());
  } catch {
    console.error("Failed to save private key");
  }
}

function isTelemetryEnabled() {
  try {
    return localStorage.getItem("StreakTracker_telemetry") !== "off";
  } catch {
    return true;
  }
}

function setTelemetryEnabled(enabled) {
  try {
    localStorage.setItem("StreakTracker_telemetry", enabled ? "on" : "off");
  } catch {
    console.error("Failed to save telemetry setting");
  }
}

function getRefreshInterval() {
  try {
    const val = parseInt(localStorage.getItem("StreakTracker_refresh_min"), 10);
    return val > 0 ? val : 5;
  } catch {
    return 5;
  }
}

function setRefreshInterval(minutes) {
  const val = Math.max(1, Math.round(minutes));
  localStorage.setItem("StreakTracker_refresh_min", val);
  restartFetchInterval();
}

function showPrivateKeyStatus(msg, isError = false) {
  const status = document.getElementById("private-key-status");
  if (status) {
    status.textContent = msg;
    status.style.color = isError ? "#f87171" : "#4ade80";
    setTimeout(() => {
      status.textContent = "";
    }, 2000);
  }
}

function openSettingsModal() {
  const backdrop = document.getElementById("settings-backdrop");
  const input = document.getElementById("private-key-input");
  const checkbox = document.getElementById("telemetry-checkbox");
  const refreshInput = document.getElementById("refresh-interval-input");
  if (backdrop) backdrop.style.display = "flex";
  if (input) input.value = getPrivateKey();
  if (checkbox) checkbox.checked = isTelemetryEnabled();
  if (refreshInput) refreshInput.value = getRefreshInterval();
}

function closeSettingsModal() {
  const backdrop = document.getElementById("settings-backdrop");
  if (backdrop) backdrop.style.display = "none";
}

function setupSettingsModal() {
  const closeBtn = document.getElementById("settings-close");
  const backdrop = document.getElementById("settings-backdrop");
  const modal = backdrop ? backdrop.querySelector(".settings-modal") : null;
  const saveBtn = document.getElementById("save-private-key");
  const input = document.getElementById("private-key-input");
  const checkbox = document.getElementById("telemetry-checkbox");

  const gearBtn = document.getElementById("settings-gear");
  if (gearBtn) gearBtn.addEventListener("click", openSettingsModal);
  if (closeBtn) closeBtn.addEventListener("click", closeSettingsModal);
  if (backdrop) backdrop.addEventListener("click", closeSettingsModal);
  if (modal) modal.addEventListener("click", (e) => e.stopPropagation());

  if (saveBtn && input) {
    saveBtn.addEventListener("click", () => {
      setPrivateKey(input.value);
      showPrivateKeyStatus("Saved!");
    });
  }

  if (checkbox) {
    checkbox.addEventListener("change", () => {
      setTelemetryEnabled(checkbox.checked);
    });
  }

  const refreshInput = document.getElementById("refresh-interval-input");
  if (refreshInput) {
    refreshInput.addEventListener("change", () => {
      setRefreshInterval(parseInt(refreshInput.value, 10) || 5);
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let fetchIntervalId = null;

function restartFetchInterval() {
  if (fetchIntervalId) clearInterval(fetchIntervalId);
  fetchIntervalId = setInterval(
    fetchUserData,
    getRefreshInterval() * 60 * 1000,
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeDragging();
  initializeResize();
  setupSettingsModal();
  window.parent.postMessage({ type: "getNamedData", keys: WATCHED_KEYS }, "*");

  setTimeout(async () => await fetchUserData(), 3000);
  restartFetchInterval();
});
