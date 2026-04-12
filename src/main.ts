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
let alertTimeout: ReturnType<typeof setTimeout> | null = null;
let timerState: TimerState = {
  is_running: false,
  is_paused: false,
  elapsed_seconds: 0,
  pause_count: 0,
};
let has18MinAlertShown = false;

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

// ===== Timeline Rendering =====
function renderTimeline(): void {
  const container = getEl("timeline-hours");
  container.innerHTML = "";

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Show 5 hours around current time
  const hours = [];
  for (let i = -2; i <= 2; i++) {
    hours.push((currentHour + i + 24) % 24);
  }

  hours.forEach((hour, index) => {
    const yPercent = (index / (hours.length - 1)) * 100;
    const isCurrent = hour === currentHour;

    // Dot
    const dot = document.createElement("div");
    dot.className = `timeline-dot${isCurrent ? " current" : ""}`;
    dot.style.top = `${yPercent}%`;
    container.appendChild(dot);

    // Label
    const label = document.createElement("div");
    label.className = `timeline-hour${isCurrent ? " current" : ""}`;
    label.style.top = `${yPercent}%`;
    label.style.transform = `translateX(20px) translateY(-50%)`;

    if (isCurrent) {
      label.innerHTML = `${hour}<span class="minute-suffix">${currentMinute.toString().padStart(2, "0")}</span>`;
    } else {
      label.textContent = `${hour}`;
    }
    container.appendChild(label);
  });
}

// ===== Timer Logic =====
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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

  renderTimeline();
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
  const remaining = TIMER_DURATION_SECONDS - timerState.elapsed_seconds;
  const displayTime = Math.max(0, remaining);
  getEl("timer-minutes-left").textContent = formatTime(displayTime);

  const statusText = getEl("timer-status-text");
  if (timerState.is_paused) {
    statusText.textContent = "paused (idle)";
    statusText.classList.add("paused");
  } else {
    statusText.textContent = "running";
    statusText.classList.remove("paused");
  }

  // Update timeline
  renderTimeline();
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
  const alert = getEl("alert-notification");
  alert.classList.remove("hidden");

  // Also trigger system notification via Rust
  invoke("send_notification", {
    title: "eyeCATCHER",
    body: "2 minutes left before eye break!",
  }).catch(console.error);

  // Auto-hide after 8 seconds
  if (alertTimeout) clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    alert.classList.add("hidden");
  }, 8000);
}

function triggerBlurOverlay(): void {
  // Stop main timer
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Hide alert if visible
  getEl("alert-notification").classList.add("hidden");

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
  getEl("alert-notification").classList.add("hidden");

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
    loadStats("today");
    showScreen("stats-screen");
  });

  getEl("go-timer-btn").addEventListener("click", () => {
    showScreen("timer-screen");
  });

  // Stats tabs
  getEl("tab-weekly").addEventListener("click", () => {
    getEl("tab-weekly").classList.add("active");
    getEl("tab-monthly").classList.remove("active");
    loadStats("weekly");
  });

  getEl("tab-monthly").addEventListener("click", () => {
    getEl("tab-monthly").classList.add("active");
    getEl("tab-weekly").classList.remove("active");
    loadStats("monthly");
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
