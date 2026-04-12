import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ===== Types =====
interface SessionStats {
  successful_sessions: number;
  terminations: number;
  times_paused: number;
}

interface TimerState {
  is_running: boolean;
  is_paused: boolean;
  elapsed_seconds: number;
  pause_count: number;
}

// ===== State =====
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerState: TimerState = {
  is_running: false,
  is_paused: false,
  elapsed_seconds: 0,
  pause_count: 0,
};
let has18MinAlertShown = false;
let currentStatsPeriod = "today";

// ===== Constants =====
const TIMER_DURATION_SECONDS = 20 * 60; // 20 minutes
const ALERT_AT_SECONDS = 18 * 60; // 18 minutes (2 min warning)
// Idle threshold handled by Rust backend (2 minutes)
// Blur duration is configured in src/blur.ts (20 seconds)

// ===== DOM Elements =====
function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

// ===== Screen Navigation =====
function showScreen(screenId: string): void {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  getEl(screenId).classList.add("active");
}

// ===== Minute Scroll Rendering =====
function renderMinuteScroll(): void {
  const container = getEl("minute-scroll-list");
  container.innerHTML = "";

  const remaining = TIMER_DURATION_SECONDS - timerState.elapsed_seconds;
  const displayTime = Math.max(0, remaining);
  const currentMinute = Math.floor(displayTime / 60);
  const currentSecond = displayTime % 60;

  // Show 5 minute entries centered on current minute
  for (let i = -2; i <= 2; i++) {
    const minute = currentMinute + i;
    if (minute < 0) continue;

    const item = document.createElement("div");
    const isCurrent = i === 0;

    if (isCurrent) {
      item.className = "minute-item current";
      item.innerHTML = `<span class="minute-number">${minute}</span><span class="second-number">${currentSecond.toString().padStart(2, "0")}</span>`;
    } else {
      item.className = "minute-item";
      item.textContent = `${minute}`;
    }

    container.appendChild(item);
  }

  // No continuous animation — minutes snap into place only when the minute changes
}

// ===== Timer Logic =====
function startTimer(): void {
  timerState = {
    is_running: true,
    is_paused: false,
    elapsed_seconds: 0,
    pause_count: 0,
  };
  has18MinAlertShown = false;

  // Switch UI
  getEl("timer-idle").classList.add("hidden");
  getEl("timer-running").classList.remove("hidden");
  getEl("terminate-btn").classList.remove("hidden");

  renderMinuteScroll();
  updateTimerDisplay();

  // Notify Rust backend
  invoke("start_timer").catch(console.error);

  // Start interval
  timerInterval = setInterval(() => {
    if (!timerState.is_paused && timerState.is_running) {
      timerState.elapsed_seconds++;
      updateTimerDisplay();
      checkTimerMilestones();
    }
  }, 1000);
}

function updateTimerDisplay(): void {
  renderMinuteScroll();
}

function checkTimerMilestones(): void {
  // 18-minute mark: show 2-min warning
  if (timerState.elapsed_seconds >= ALERT_AT_SECONDS && !has18MinAlertShown) {
    has18MinAlertShown = true;
    showAlertNotification();
  }

  // 20-minute mark: trigger blur overlay
  if (timerState.elapsed_seconds >= TIMER_DURATION_SECONDS) {
    triggerBlurOverlay();
  }
}

function showAlertNotification(): void {
  // Only trigger system notification via Rust (no in-app notification)
  invoke("send_notification", {
    title: "eyeCATCHER",
    body: "2 minutes left before eye break!",
  }).catch(console.error);
}

function triggerBlurOverlay(): void {
  // Stop main timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Open fullscreen blur overlay window (covers entire desktop)
  invoke("open_blur_overlay").catch(console.error);
}

function onBlurComplete(): void {
  // Save session as successful
  invoke("save_session", {
    successful: true,
    pauses: timerState.pause_count,
  }).catch(console.error);

  // Reset and restart for next cycle
  resetTimerUI();
  startTimer();
}

function terminateTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  timerState.is_running = false;

  // Save as termination
  invoke("save_session", {
    successful: false,
    pauses: timerState.pause_count,
  }).catch(console.error);

  invoke("stop_timer").catch(console.error);

  resetTimerUI();
}

function resetTimerUI(): void {
  getEl("timer-idle").classList.remove("hidden");
  getEl("timer-running").classList.add("hidden");
  getEl("terminate-btn").classList.add("hidden");

  timerState = {
    is_running: false,
    is_paused: false,
    elapsed_seconds: 0,
    pause_count: 0,
  };
  has18MinAlertShown = false;
}

function pauseTimer(): void {
  if (timerState.is_running && !timerState.is_paused) {
    timerState.is_paused = true;
    timerState.pause_count++;
    updateTimerDisplay();
    invoke("pause_timer").catch(console.error);
  }
}

function resumeTimer(): void {
  if (timerState.is_running && timerState.is_paused) {
    timerState.is_paused = false;
    updateTimerDisplay();
    invoke("resume_timer").catch(console.error);
  }
}

// ===== Statistics =====
function switchStats(period: string): void {
  currentStatsPeriod = period;
  loadStats(period);
  updateStatsTabs();
}

function updateStatsTabs(): void {
  const leftBtn = getEl("tab-left");
  const rightBtn = getEl("tab-right");

  switch (currentStatsPeriod) {
    case "today":
      leftBtn.innerHTML = "&lt; Weekly";
      rightBtn.innerHTML = "Monthly &gt;";
      break;
    case "weekly":
      leftBtn.innerHTML = "&lt; Daily";
      rightBtn.innerHTML = "Monthly &gt;";
      break;
    case "monthly":
      leftBtn.innerHTML = "&lt; Weekly";
      rightBtn.innerHTML = "Daily &gt;";
      break;
  }
}

async function loadStats(period: string): Promise<void> {
  try {
    const stats: SessionStats = await invoke("get_stats", { period });
    getEl("stat-successful").textContent = String(stats.successful_sessions);
    getEl("stat-terminations").textContent = String(stats.terminations);
    getEl("stat-paused").textContent = String(stats.times_paused);

    // Update title based on period
    if (period === "today") {
      getEl("stats-screen").querySelector(".stats-title")!.textContent = "Todays Record";
    } else if (period === "weekly") {
      getEl("stats-screen").querySelector(".stats-title")!.textContent = "Weekly Record";
    } else {
      getEl("stats-screen").querySelector(".stats-title")!.textContent = "Monthly Record";
    }
  } catch (e) {
    console.error("Failed to load stats:", e);
  }
}

// ===== Event Listeners from Rust Backend =====
async function setupBackendListeners(): Promise<void> {
  // Listen for idle detection from Rust
  await listen("user-idle", () => {
    if (timerState.is_running && !timerState.is_paused) {
      pauseTimer();
    }
  });

  await listen("user-active", () => {
    if (timerState.is_running && timerState.is_paused) {
      resumeTimer();
    }
  });

  // Listen for blur overlay completion (fullscreen window closed)
  await listen("blur-complete", () => {
    onBlurComplete();
  });
}

// ===== Initialization =====
window.addEventListener("DOMContentLoaded", () => {
  // Splash -> Timer
  getEl("continue-btn").addEventListener("click", () => {
    showScreen("timer-screen");
  });

  // Start timer
  getEl("start-timer-btn").addEventListener("click", () => {
    startTimer();
  });

  // Terminate timer
  getEl("terminate-btn").addEventListener("click", () => {
    terminateTimer();
  });

  // Navigation
  getEl("go-stats-btn").addEventListener("click", () => {
    switchStats("today");
    showScreen("stats-screen");
  });

  getEl("go-timer-btn").addEventListener("click", () => {
    showScreen("timer-screen");
  });

  // Stats tabs - dynamic navigation between daily/weekly/monthly
  getEl("tab-left").addEventListener("click", () => {
    switch (currentStatsPeriod) {
      case "today": switchStats("weekly"); break;
      case "weekly": switchStats("today"); break;
      case "monthly": switchStats("weekly"); break;
    }
  });

  getEl("tab-right").addEventListener("click", () => {
    switch (currentStatsPeriod) {
      case "today": switchStats("monthly"); break;
      case "weekly": switchStats("monthly"); break;
      case "monthly": switchStats("today"); break;
    }
  });

  // Setup backend listeners
  setupBackendListeners();

  // Also listen for keyboard/mouse events in the webview to feed activity detection
  const reportActivity = () => {
    invoke("report_activity").catch(() => {});
  };
  document.addEventListener("mousemove", reportActivity);
  document.addEventListener("keydown", reportActivity);
  document.addEventListener("click", reportActivity);
  document.addEventListener("scroll", reportActivity);
});
