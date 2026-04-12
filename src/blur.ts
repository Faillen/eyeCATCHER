import { invoke } from "@tauri-apps/api/core";

// Must match BLUR_DURATION_SECONDS in main.ts
const BLUR_DURATION_SECONDS = 20;

window.addEventListener("DOMContentLoaded", () => {
  let countdown = BLUR_DURATION_SECONDS;
  const countdownEl = document.getElementById("blur-countdown-number");
  if (!countdownEl) return;

  countdownEl.textContent = String(countdown);

  const interval = setInterval(() => {
    countdown--;
    countdownEl.textContent = String(countdown);

    if (countdown <= 0) {
      clearInterval(interval);
      // Close this fullscreen window and notify the main window
      invoke("close_blur_overlay").catch(console.error);
    }
  }, 1000);
});
