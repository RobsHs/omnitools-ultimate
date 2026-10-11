/**
 * OmniTools Ultimate - Main Frontend Application Logic
 */

// --- Theme System ---
function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeIcon = document.getElementById("theme-icon");

  if (savedTheme === "light" || (!savedTheme && !prefersDark)) {
    document.documentElement.classList.remove("dark");
    if (themeIcon) themeIcon.className = "ph-fill ph-sun text-xl text-yellow-500";
  } else {
    document.documentElement.classList.add("dark");
    if (themeIcon) themeIcon.className = "ph-fill ph-moon text-xl text-primary";
  }
}

function toggleTheme() {
  document.documentElement.classList.toggle("dark");
  const isDark = document.documentElement.classList.contains("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  const themeIcon = document.getElementById("theme-icon");
  if (themeIcon) {
    themeIcon.className = isDark
      ? "ph-fill ph-moon text-xl text-primary"
      : "ph-fill ph-sun text-xl text-yellow-500";
  }
}

// --- Performance Mode System (Eco-Glass for Potato Laptop & Mobile) ---
function initPerformanceMode() {
  const savedPerf = localStorage.getItem("omnitools_perf_mode");
  const isPotatoDevice =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // If user hasn't chosen yet, enable Eco Glass automatically on potato hardware
  const shouldEnable = savedPerf === "true" || (savedPerf === null && isPotatoDevice);

  applyPerformanceMode(shouldEnable);
}

function applyPerformanceMode(enabled) {
  if (enabled) {
    document.documentElement.classList.add("perf-mode");
    document.body.classList.add("perf-mode");
  } else {
    document.documentElement.classList.remove("perf-mode");
    document.body.classList.remove("perf-mode");
  }

  const perfBtn = document.getElementById("perf-mode-btn");
  const perfIcon = document.getElementById("perf-mode-icon");
  const perfText = document.getElementById("perf-mode-text");

  if (perfBtn) {
    if (enabled) {
      perfBtn.classList.add("text-amber-500", "bg-amber-500/15", "border", "border-amber-500/30");
      perfBtn.classList.remove("text-themeMuted");
      if (perfIcon) perfIcon.className = "ph-fill ph-lightning text-amber-500 text-base animate-pulse";
      if (perfText) perfText.innerText = "Eco Glass (On)";
    } else {
      perfBtn.classList.remove("text-amber-500", "bg-amber-500/15", "border", "border-amber-500/30");
      perfBtn.classList.add("text-themeMuted");
      if (perfIcon) perfIcon.className = "ph-bold ph-lightning text-themeMuted text-base";
      if (perfText) perfText.innerText = "Eco Glass";
    }
  }
}

function togglePerformanceMode() {
  const currentlyActive = document.documentElement.classList.contains("perf-mode");
  const nextState = !currentlyActive;
  localStorage.setItem("omnitools_perf_mode", String(nextState));
  applyPerformanceMode(nextState);

  if (nextState) {
    showToast("Mode Ringan (Eco-Glass) Aktif: Blur & animasi diringankan untuk kelancaran maksimal.", "info");
  } else {
    showToast("Mode Visual Penuh Aktif: Efek glassmorphism iOS 26 diaktifkan.", "info");
  }
}

// --- Authentication & Session System ---
let currentUser = null;

function getStoredToken() {
  return localStorage.getItem("omnitools_token") || sessionStorage.getItem("omnitools_token");
}

function getStoredUser() {
  const u = localStorage.getItem("omnitools_user") || sessionStorage.getItem("omnitools_user");
  try {
    return u ? JSON.parse(u) : null;
  } catch (_) {
    return null;
  }
}

function setStoredSession(token, user, rememberMe = true) {
  if (rememberMe) {
    localStorage.setItem("omnitools_token", token);
    localStorage.setItem("omnitools_user", JSON.stringify(user));
  } else {
    sessionStorage.setItem("omnitools_token", token);
    sessionStorage.setItem("omnitools_user", JSON.stringify(user));
  }
  currentUser = user;
}

function clearStoredSession() {
  localStorage.removeItem("omnitools_token");
  localStorage.removeItem("omnitools_user");
  sessionStorage.removeItem("omnitools_token");
  sessionStorage.removeItem("omnitools_user");
  currentUser = null;
}

function initAuth() {
  const token = getStoredToken();
  const user = getStoredUser();

  if (token && user) {
    currentUser = user;
    hideAuthGate();
    updateUserUI(user);
    if (window.api && window.api.getMe) {
      window.api.getMe(token).then((res) => {
        if (res && res.success && res.user) {
          currentUser = { ...user, ...res.user };
          updateUserUI(currentUser);
        }
      }).catch((err) => {
        console.warn("Session verification expired or invalid:", err);
        clearStoredSession();
        showAuthGate();
      });
    }
  } else {
    showAuthGate();
  }
}

function showAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) {
    gate.classList.remove("auth-gate-hidden");
  }
}

function hideAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) {
    gate.classList.add("auth-gate-hidden");
  }
}

function updateUserUI(user) {
  if (!user) return;
  const username = user.username || "User";
  const role = user.role || "Member";

  // Top header user display
  const headerUsername = document.getElementById("header-username");
  if (headerUsername) headerUsername.innerText = username;

  // Device card displays
  const devUser = document.getElementById("device-user-display");
  if (devUser) devUser.innerText = username;

  const devRole = document.getElementById("device-role-display");
  if (devRole) devRole.innerText = role;
}

function setAuthTab(tab) {
  const loginForm = document.getElementById("login-form");
  const regForm = document.getElementById("register-form");
  const tabLoginBtn = document.getElementById("tab-login-btn");
  const tabRegBtn = document.getElementById("tab-register-btn");
  const mainTitle = document.getElementById("auth-main-title");

  if (tab === "register") {
    if (loginForm) loginForm.classList.add("hidden");
    if (regForm) regForm.classList.remove("hidden");
    if (tabLoginBtn) tabLoginBtn.classList.remove("active");
    if (tabRegBtn) tabRegBtn.classList.add("active");
    if (mainTitle) mainTitle.innerText = "REGISTER WITH";
  } else {
    if (loginForm) loginForm.classList.remove("hidden");
    if (regForm) regForm.classList.add("hidden");
    if (tabLoginBtn) tabLoginBtn.classList.add("active");
    if (tabRegBtn) tabRegBtn.classList.remove("active");
    if (mainTitle) mainTitle.innerText = "LOGIN WITH";

    // Auto-fill login-username if reg-username was entered
    const regUser = document.getElementById("reg-username");
    const loginUser = document.getElementById("login-username");
    if (regUser && loginUser && (!loginUser.value || loginUser.value === "") && regUser.value) {
      loginUser.value = regUser.value.trim();
    }
  }
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === "password";
  input.type = isPass ? "text" : "password";
  const icon = btn.querySelector("i");
  if (icon) {
    icon.className = isPass ? "ph ph-eye-slash text-lg text-blue-500" : "ph ph-eye text-lg";
  }
}

async function handleAuthLogin(event) {
  event.preventDefault();
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const rememberInput = document.getElementById("login-remember");
  const submitBtn = document.getElementById("login-submit-btn");

  const username = usernameInput ? usernameInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value : "";
  const rememberMe = rememberInput ? rememberInput.checked : true;

  if (!username || !password) {
    showToast("Please enter username and password.", "error");
    return;
  }

  const originalContent = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loader w-4 h-4 border-2 border-slate-900 border-b-transparent inline-block mr-2"></span> Authenticating...`;

  try {
    const res = await window.api.login(username, password, rememberMe);
    if (res.success && res.token && res.user) {
      setStoredSession(res.token, res.user, rememberMe);
      updateUserUI(res.user);
      initDeviceData();
      hideAuthGate();
      showToast(res.message || `Welcome back, ${res.user.username}!`, "success");
    } else {
      showToast(res.error || "Login failed.", "error");
    }
  } catch (err) {
    showToast(err.message || "Failed to log in. Please check your credentials.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalContent;
  }
}

async function handleAuthRegister(event) {
  event.preventDefault();
  const usernameInput = document.getElementById("reg-username");
  const passwordInput = document.getElementById("reg-password");
  const confirmInput = document.getElementById("reg-confirm-password");
  const submitBtn = document.getElementById("reg-submit-btn");

  const username = usernameInput ? usernameInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value : "";
  const confirmPassword = confirmInput ? confirmInput.value : "";

  if (!username || !password) {
    showToast("Please enter username and password.", "error");
    return;
  }

  if (confirmPassword && password !== confirmPassword) {
    showToast("Passwords do not match.", "error");
    return;
  }

  const originalContent = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loader w-4 h-4 border-2 border-slate-900 border-b-transparent inline-block mr-2"></span> Registering...`;

  try {
    const res = await window.api.register(username, password, confirmPassword || password);
    if (res.success && res.token && res.user) {
      setStoredSession(res.token, res.user, true);
      updateUserUI(res.user);
      initDeviceData();
      hideAuthGate();
      showToast(res.message || `Welcome, ${res.user.username}!`, "success");
      
      const loginUser = document.getElementById("login-username");
      if (loginUser) loginUser.value = res.user.username;
    } else {
      showToast(res.error || "Registration failed.", "error");
    }
  } catch (err) {
    showToast(err.message || "Registration failed.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalContent;
  }
}

async function handleLogout() {
  const token = getStoredToken();
  if (token && window.api && window.api.logout) {
    try {
      await window.api.logout(token);
    } catch (_) {}
  }
  clearStoredSession();
  showAuthGate();
  showToast("Logged out successfully.", "info");
}

function handleForgotPassword() {
  showToast("Default developer credentials: RobsHs / robshs123. Or create your own account via Register.", "info");
}

// --- Data Perangkat (Device & Battery Intelligence) ---
function initDeviceData() {
  // 1. Detect Operating System
  const userAgent = window.navigator.userAgent;
  let osName = "Windows";
  let osIcon = "ph-fill ph-windows-logo text-xl";

  if (userAgent.indexOf("Win") !== -1) {
    osName = "Windows";
    osIcon = "ph-fill ph-windows-logo text-xl";
  } else if (userAgent.indexOf("Mac") !== -1) {
    if (userAgent.indexOf("iPhone") !== -1 || userAgent.indexOf("iPad") !== -1) {
      osName = "iOS";
      osIcon = "ph-fill ph-device-mobile text-xl";
    } else {
      osName = "macOS";
      osIcon = "ph-fill ph-apple-logo text-xl";
    }
  } else if (userAgent.indexOf("Android") !== -1) {
    osName = "Android";
    osIcon = "ph-fill ph-android-logo text-xl";
  } else if (userAgent.indexOf("Linux") !== -1) {
    osName = "Linux";
    osIcon = "ph-fill ph-linux-logo text-xl";
  }

  const osDisplay = document.getElementById("device-os-display");
  if (osDisplay) osDisplay.innerText = osName;

  const osIconEl = document.getElementById("device-os-icon");
  if (osIconEl) osIconEl.className = osIcon;

  // 2. User & Role
  const user = currentUser || getStoredUser();
  if (user) {
    updateUserUI(user);
  } else {
    const devUser = document.getElementById("device-user-display");
    if (devUser) devUser.innerText = "Guest";
  }

  // 3. Battery Intelligence
  const batteryDisplay = document.getElementById("device-battery-display");
  const batteryBar = document.getElementById("device-battery-bar");
  const batteryIcon = document.getElementById("device-battery-icon");

  function setBatteryUI(pct, isCharging) {
    if (batteryDisplay) {
      batteryDisplay.innerText = `${pct}% ${isCharging ? "(charging)" : ""}`.trim();
    }
    if (batteryBar) {
      batteryBar.style.width = `${pct}%`;
    }
    if (batteryIcon) {
      if (isCharging) {
        batteryIcon.className = "ph-fill ph-battery-charging text-xl text-blue-400";
      } else if (pct <= 20) {
        batteryIcon.className = "ph-fill ph-battery-warning text-xl text-amber-400";
      } else {
        batteryIcon.className = "ph-fill ph-battery-full text-xl text-emerald-400";
      }
    }
  }

  if (typeof navigator.getBattery === "function") {
    navigator.getBattery().then((battery) => {
      const updateBattery = () => {
        const pct = Math.round(battery.level * 100);
        setBatteryUI(pct, battery.charging);
      };
      updateBattery();
      battery.addEventListener("chargingchange", updateBattery);
      battery.addEventListener("levelchange", updateBattery);
    }).catch(() => {
      setBatteryUI(100, true);
    });
  } else {
    setBatteryUI(100, true);
  }
}

// --- Navigation & Core App ---
let currentTab = "dashboard";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initPerformanceMode();
  initAuth();
  initDeviceData();
  if (typeof generatePassword === "function") generatePassword();
  if (typeof updateColors === "function") updateColors();
  if (typeof renderMarkdown === "function") renderMarkdown();
});

function openSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobile-overlay");
  if (sidebar) {
    sidebar.classList.remove("-translate-x-full");
    sidebar.classList.add("open");
  }
  if (overlay) {
    overlay.classList.remove("hidden");
  }
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("mobile-overlay");
  if (sidebar) {
    sidebar.classList.add("-translate-x-full");
    sidebar.classList.remove("open");
  }
  if (overlay) {
    overlay.classList.add("hidden");
  }
  document.body.classList.remove("sidebar-open");
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const isClosed = sidebar.classList.contains("-translate-x-full") || !sidebar.classList.contains("open");
  if (isClosed) {
    openSidebar();
  } else {
    closeSidebar();
  }
}

// Close sidebar on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSidebar();
  }
});

function switchTab(tabId, el) {
  currentTab = tabId;

  const activeNav = el || document.querySelector(`[data-target="${tabId}"]`);
  const pageTitle = document.getElementById("page-title");
  if (pageTitle && activeNav) {
    const titleSpan = activeNav.querySelector("span:not(.bg-red-500\\/20)");
    if (titleSpan) pageTitle.innerText = titleSpan.innerText.trim();
  }

  document.querySelectorAll(".tool-section").forEach((sec) => {
    sec.classList.add("hidden");
    sec.classList.remove("fade-in");
  });

  const targetSec = document.getElementById(tabId);
  if (targetSec) {
    targetSec.classList.remove("hidden");
    void targetSec.offsetWidth;
    targetSec.classList.add("fade-in");
  }

  document.querySelectorAll(".nav-item").forEach((nav) => {
    nav.classList.remove("text-primary", "bg-primary/10", "font-medium");
    nav.classList.add("text-themeMuted");
  });

  if (activeNav) {
    activeNav.classList.add("text-primary", "bg-primary/10", "font-medium");
    activeNav.classList.remove("text-themeMuted");
  }

  if (
    tabId === "ip-checker" &&
    document.getElementById("ip-address-display") &&
    document.getElementById("ip-address-display").innerText === "..."
  ) {
    fetchIP();
  }

  // Smooth scroll container to top
  const mainScroll = document.querySelector("main .overflow-y-auto");
  if (mainScroll) {
    mainScroll.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Always close sidebar drawer on mobile after switching tab
  if (window.innerWidth < 1024) {
    closeSidebar();
  }
}

function navigateToTool(tabId) {
  const navBtn = document.querySelector(`[data-target="${tabId}"]`);
  switchTab(tabId, navBtn || null);
}

// --- Toast Notifications ---
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const iconColor =
    type === "success"
      ? "text-green-500"
      : type === "error"
        ? "text-red-500"
        : "text-blue-500";
  const icon =
    type === "success"
      ? "ph-check-circle"
      : type === "error"
        ? "ph-warning-circle"
        : "ph-info";

  toast.className = `bg-themeSurface border border-themeBorder text-themeText px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transform transition-all duration-300 translate-y-10 opacity-0 pointer-events-auto`;
  toast.innerHTML = `<i class="ph-fill ${icon} ${iconColor} text-lg"></i><span class="text-sm font-bold">${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => toast.classList.remove("translate-y-10", "opacity-0"), 10);
  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Clipboard Copy ---
function copyText(elId, msg = "Copied to clipboard") {
  const el = document.getElementById(elId);
  if (!el) return;

  const text =
    el.tagName === "INPUT" || el.tagName === "TEXTAREA"
      ? el.value
      : el.innerText;

  const fallback = (t) => {
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast(msg, "success");
    } catch (e) {
      showToast("Error copying", "error");
    }
    document.body.removeChild(ta);
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(msg, "success"))
      .catch(() => fallback(text));
  } else {
    fallback(text);
  }
}

// ==========================================
// --- NETWORK & WEB TOOLS ---
// ==========================================

async function fetchIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    document.getElementById("ip-address-display").innerText = data.ip;
    document.getElementById("ip-loading").classList.add("hidden");
    const resEl = document.getElementById("ip-result");
    resEl.classList.remove("hidden");
    resEl.classList.add("flex");
  } catch (e) {
    showToast("Failed to fetch IP", "error");
  }
}

async function handleWebInspector(e) {
  e.preventDefault();
  const inputEl = document.getElementById("inspect-domain");
  let dom = inputEl.value.trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, "")
    .split("/")[0];

  const btn = document.getElementById("btn-inspect");
  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-2"></span>Resolving...`;
  btn.disabled = true;

  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(dom)}&type=A`);
    const data = await res.json();
    document.getElementById("inspect-target").innerText = dom;
    document.getElementById("inspect-ips").innerHTML = data.Answer
      ? data.Answer.filter((a) => a.type === 1)
          .map((a) => `<div class="bg-black/10 dark:bg-black/30 p-2 rounded font-mono">${a.data}</div>`)
          .join("")
      : '<div class="text-red-500">No A records found</div>';
    document.getElementById("inspect-result").classList.remove("hidden");
    showToast("Resolved successfully", "success");
  } catch (err) {
    showToast("Failed to inspect domain", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleDnsSubmit(e) {
  e.preventDefault();
  const domain = document.getElementById("dns-domain").value.trim();
  const type = document.getElementById("dns-type").value;
  const btn = e.target.querySelector('button[type="submit"]');
  const resultsArea = document.getElementById("dns-results");
  const output = document.getElementById("dns-output");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Searching...`;
  btn.disabled = true;

  try {
    const data = await api.getDnsRecords(domain, type);
    resultsArea.classList.remove("hidden");
    output.innerText = typeof data.result === "string" 
      ? data.result 
      : JSON.stringify(data.result, null, 2);
    showToast("Real DNS Records Retrieved!", "success");
  } catch (err) {
    showToast(err.message || "Failed to lookup DNS", "error");
    resultsArea.classList.remove("hidden");
    output.innerText = `Error: ${err.message}`;
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleDomainSubmit(e) {
  e.preventDefault();
  const domain = document.getElementById("domain-input").value.trim();
  const btn = e.target.querySelector('button[type="submit"]');
  const resArea = document.getElementById("domain-result-area");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Checking...`;
  btn.disabled = true;

  try {
    const data = await api.checkDomainAvailability(domain);
    resArea.classList.remove("hidden");
    if (data.available) {
      resArea.className =
        "mt-6 p-4 rounded-xl border flex items-center justify-center gap-3 text-lg font-bold bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400";
      resArea.innerHTML = `<i class="ph-fill ph-check-circle text-2xl"></i> ${domain} is Available to Register!`;
    } else {
      resArea.className =
        "mt-6 p-4 rounded-xl border flex items-center justify-center gap-3 text-lg font-bold bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400";
      resArea.innerHTML = `<i class="ph-fill ph-x-circle text-2xl"></i> ${domain} is Already Registered.`;
    }
    showToast("Domain Checked!", "success");
  } catch (err) {
    showToast(err.message || "Error checking domain", "error");
    resArea.classList.remove("hidden");
    resArea.className =
      "mt-6 p-4 rounded-xl border flex items-center justify-center gap-3 text-base font-bold bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400";
    resArea.innerHTML = `<i class="ph-fill ph-warning text-2xl"></i> ${err.message}`;
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

// ==========================================
// --- MEDIA & BYPASS TOOLS ---
// ==========================================

async function handleBypass(e) {
  e.preventDefault();
  const url = document.getElementById("bypass-input").value.trim();
  const btn = e.target.querySelector('button[type="submit"]');
  const resBox = document.getElementById("bypass-result");
  const out = document.getElementById("bypass-output");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Bypassing...`;
  btn.disabled = true;
  resBox.classList.add("hidden");

  try {
    const data = await api.bypassUrl(url);
    out.innerText = data.destinationUrl || data.url;
    resBox.classList.remove("hidden");
    showToast("Bypass Successful!", "success");
  } catch (err) {
    showToast(err.message || "Bypass failed", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleMediaDownload(e) {
  e.preventDefault();
  const url = document.getElementById("media-input").value.trim();
  const btn = document.getElementById("btn-media");
  const resultBox = document.getElementById("media-result");
  const titleEl = document.getElementById("media-title");
  const authorEl = document.getElementById("media-author");
  const thumbEl = document.getElementById("media-thumbnail");
  const videoLink = document.getElementById("media-video-link");
  const audio128Link = document.getElementById("media-audio-128-link");
  const audio320Link = document.getElementById("media-audio-320-link");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Fetching...`;
  btn.disabled = true;

  try {
    const data = await api.getMediaDownloadInfo(url);
    if (titleEl) titleEl.innerText = data.title || "Media Stream Found";
    if (authorEl) authorEl.innerText = data.author || "";
    if (thumbEl && data.thumbnail) thumbEl.src = data.thumbnail;
    
    const safeName = (data.title || "media").replace(/[^\w\s.-]/gi, "").trim().replace(/\s+/g, "_") || "download";
    if (videoLink) {
      if (data.videoUrl) {
        videoLink.href = data.videoUrl;
        videoLink.setAttribute("download", `${safeName}.mp4`);
        videoLink.style.display = 'flex';
        videoLink.onclick = () => showToast("Starting real MP4 video download...", "info");
      } else {
        videoLink.style.display = 'none';
      }
    }
    if (audio128Link) {
      if (data.audio128Url) {
        audio128Link.href = data.audio128Url;
        audio128Link.setAttribute("download", `${safeName}_128k.mp3`);
        audio128Link.style.display = 'flex';
        audio128Link.onclick = () => showToast("Starting 128kbps MP3 download (compatible with old devices)...", "info");
      } else {
        audio128Link.style.display = 'none';
      }
    }
    if (audio320Link) {
      if (data.audio320Url) {
        audio320Link.href = data.audio320Url;
        audio320Link.setAttribute("download", `${safeName}_320k.mp3`);
        audio320Link.style.display = 'flex';
        audio320Link.onclick = () => showToast("Starting 320kbps HQ MP3 download...", "info");
      } else {
        audio320Link.style.display = 'none';
      }
    }

    resultBox.classList.remove("hidden");
    resultBox.classList.add("flex");
    showToast("Real download streams ready!", "success");
  } catch (err) {
    showToast(err.message || "Failed to extract media", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleSpotify(e) {
  e.preventDefault();
  const url = document.getElementById("spotify-input").value.trim();
  const btn = document.getElementById("btn-spotify");
  const resultBox = document.getElementById("spotify-result");
  const titleEl = document.getElementById("spotify-title");
  const artistEl = document.getElementById("spotify-artist");
  const coverEl = document.getElementById("spotify-cover");
  const audio128Link = document.getElementById("spotify-audio-128-link");
  const audio320Link = document.getElementById("spotify-audio-320-link");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Fetching...`;
  btn.disabled = true;

  try {
    const data = await api.getSpotifyDownloadInfo(url);
    if (titleEl) titleEl.innerText = data.title || "Track Title";
    if (artistEl) artistEl.innerText = data.artist || "Artist";
    if (coverEl && data.cover) coverEl.src = data.cover;

    const safeTrack = `${data.title || 'track'} - ${data.artist || 'artist'}`.replace(/[^\w\s.-]/gi, "").trim().replace(/\s+/g, "_") || "spotify_track";
    if (audio128Link) {
      audio128Link.href = data.audio128Url || "#";
      audio128Link.setAttribute("download", `${safeTrack}_128k.mp3`);
      audio128Link.onclick = () => showToast("Downloading real 128kbps MP3 (compatible with old devices)...", "info");
    }
    if (audio320Link) {
      audio320Link.href = data.audio320Url || "#";
      audio320Link.setAttribute("download", `${safeTrack}_320k.mp3`);
      audio320Link.onclick = () => showToast("Downloading real 320kbps HQ MP3...", "info");
    }

    resultBox.classList.remove("hidden");
    resultBox.classList.add("flex");
    showToast("Spotify Track Ready to Download!", "success");
  } catch (err) {
    showToast(err.message || "Failed to fetch Spotify track", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const previewContainer = document.getElementById("img-preview-container");
  const previewImg = document.getElementById("img-preview");
  const resultBox = document.getElementById("img-result");
  const urlOut = document.getElementById("img-url-out");

  // Show local preview
  const reader = new FileReader();
  reader.onload = function (evt) {
    if (previewContainer) previewContainer.classList.add("hidden");
    if (previewImg) {
      previewImg.src = evt.target.result;
      previewImg.classList.remove("hidden");
    }
  };
  reader.readAsDataURL(file);

  showToast("Uploading to ImgBB...", "info");

  try {
    const data = await api.uploadImage(file);
    if (resultBox) resultBox.classList.remove("hidden");
    if (urlOut) urlOut.value = data.url || data.display_url;
    showToast("Image Uploaded Successfully!", "success");
  } catch (err) {
    showToast(err.message || "Image upload failed", "error");
  }
}

// ==========================================
// --- DEVELOPER CORE TOOLS ---
// ==========================================

async function handleSourceFetch(e) {
  e.preventDefault();
  const url = document.getElementById("source-url").value.trim();
  const btn = document.getElementById("btn-source");
  const out = document.getElementById("source-output");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Fetching...`;
  btn.disabled = true;

  try {
    const data = await api.fetchSourceCode(url);
    const htmlContent = data.source || data.contents || "";
    out.innerText = htmlContent;

    // Package to ZIP using JSZip
    if (typeof JSZip !== "undefined") {
      const zip = new JSZip();
      zip.file("index.html", htmlContent);
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `${new URL(url).hostname || "source"}.zip`;
      link.click();
      showToast("Downloaded Source ZIP", "success");
    } else {
      showToast("Source retrieved successfully", "success");
    }
  } catch (err) {
    out.innerText = `Error fetching source: ${err.message}`;
    showToast(err.message || "Failed to fetch website source", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

function formatJSON() {
  const inputEl = document.getElementById("json-input");
  const outputEl = document.getElementById("json-output");
  try {
    const parsed = JSON.parse(inputEl.value);
    outputEl.value = JSON.stringify(parsed, null, 4);
    outputEl.classList.remove("text-red-500");
    outputEl.classList.add("text-green-600", "dark:text-green-400");
  } catch (e) {
    outputEl.value = "Error: " + e.message;
    outputEl.classList.remove("text-green-600", "dark:text-green-400");
    outputEl.classList.add("text-red-500");
  }
}

function minifyJSON() {
  const inputEl = document.getElementById("json-input");
  const outputEl = document.getElementById("json-output");
  try {
    outputEl.value = JSON.stringify(JSON.parse(inputEl.value));
    outputEl.classList.remove("text-red-500");
    outputEl.classList.add("text-green-600", "dark:text-green-400");
  } catch (e) {
    outputEl.value = "Error: " + e.message;
    outputEl.classList.add("text-red-500");
  }
}

function decodeJWT() {
  try {
    const val = document.getElementById("jwt-input").value.trim();
    const parts = val.split(".");
    if (parts.length !== 3) {
      showToast("Invalid JWT structure", "error");
      return;
    }
    document.getElementById("jwt-header").value = JSON.stringify(
      JSON.parse(atob(parts[0])),
      null,
      2
    );
    document.getElementById("jwt-payload").value = JSON.stringify(
      JSON.parse(atob(parts[1])),
      null,
      2
    );
    showToast("JWT Decoded", "success");
  } catch (e) {
    showToast("Failed to decode JWT: " + e.message, "error");
  }
}

function generateHashes() {
  const txt = document.getElementById("hash-input").value;
  if (typeof CryptoJS === "undefined") return;
  document.getElementById("hash-md5").value = txt
    ? CryptoJS.MD5(txt).toString()
    : "";
  document.getElementById("hash-sha1").value = txt
    ? CryptoJS.SHA1(txt).toString()
    : "";
  document.getElementById("hash-sha256").value = txt
    ? CryptoJS.SHA256(txt).toString()
    : "";
}

function sanitizeXSS() {
  const raw = document.getElementById("xss-input").value;
  document.getElementById("xss-output").innerText = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function processBase64() {
  const mode = document.getElementById("b64-mode").value;
  const input = document.getElementById("b64-input").value;
  const out = document.getElementById("b64-output");
  try {
    out.value =
      mode === "encode"
        ? btoa(unescape(encodeURIComponent(input)))
        : decodeURIComponent(escape(atob(input)));
  } catch (e) {
    out.value = "Error: Invalid input string";
  }
}

function processUrl(action) {
  const input = document.getElementById("url-input").value;
  const out = document.getElementById("url-output");
  try {
    out.value =
      action === "encode" ? encodeURIComponent(input) : decodeURIComponent(input);
  } catch (e) {
    out.value = "Error: Invalid URL encoding";
  }
}

// ==========================================
// --- UTILITIES & GENERATORS ---
// ==========================================

function handleQR(e) {
  e.preventDefault();
  const val = document.getElementById("qr-input").value.trim();
  const img = document.getElementById("qr-img");
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(val)}`;
  img.onload = () => {
    document.getElementById("qr-result").classList.remove("hidden");
    showToast("QR Code Generated", "success");
  };
}

function generatePassword() {
  const lenEl = document.getElementById("pwd-length");
  if (!lenEl) return;
  const l = parseInt(lenEl.value);
  let c = "";
  if (document.getElementById("pwd-upper").checked)
    c += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (document.getElementById("pwd-lower").checked)
    c += "abcdefghijklmnopqrstuvwxyz";
  if (document.getElementById("pwd-numbers").checked) c += "0123456789";
  if (document.getElementById("pwd-symbols").checked)
    c += "!@#$%^&*()_+~`|}{[]:;?><,./-=";
  let p = "";
  for (let i = 0; i < l; i++) {
    p += c.charAt(Math.floor(Math.random() * c.length));
  }
  document.getElementById("pwd-display").innerText = p || "---";
}

function updateTextStats() {
  const txt = document.getElementById("text-tool-input").value;
  document.getElementById("tt-chars").innerText = txt.length;
  document.getElementById("tt-chars-no").innerText = txt.replace(/\s/g, "").length;
  document.getElementById("tt-words").innerText =
    txt.trim() === "" ? 0 : txt.trim().split(/\s+/).length;
  document.getElementById("tt-lines").innerText =
    txt === "" ? 0 : txt.split(/\r\n|\r|\n/).length;
  document.getElementById("tt-paras").innerText =
    txt === "" ? 0 : txt.replace(/\n$/gm, "").split(/\n/).length;
  document.getElementById("tt-read").innerText =
    Math.ceil(
      (txt.trim() === "" ? 0 : txt.trim().split(/\s+/).length) / 200
    ) + " min";
}

function transformText(type) {
  const ta = document.getElementById("text-tool-input");
  if (type === "upper") ta.value = ta.value.toUpperCase();
  if (type === "lower") ta.value = ta.value.toLowerCase();
  if (type === "trim") ta.value = ta.value.replace(/\s+/g, " ").trim();
  if (type === "title")
    ta.value = ta.value
      .toLowerCase()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.substring(1))
      .join(" ");
  updateTextStats();
}

function renderMarkdown() {
  const mdInput = document.getElementById("md-input");
  const mdOutput = document.getElementById("md-output");
  if (!mdInput || !mdOutput) return;

  const input = mdInput.value;
  if (typeof marked !== "undefined") {
    mdOutput.innerHTML = marked.parse(
      input || "# Hello Markdown\nStart typing on the left to see the preview here."
    );
  }
}

function updateColors() {
  const picker = document.getElementById("color-picker");
  if (!picker) return;
  const hex = picker.value;
  document.getElementById("color-hex").value = hex.toUpperCase();
  let r = parseInt(hex.substring(1, 3), 16),
    g = parseInt(hex.substring(3, 5), 16),
    b = parseInt(hex.substring(5, 7), 16);
  document.getElementById("color-rgb").value = `rgb(${r}, ${g}, ${b})`;
  r /= 255;
  g /= 255;
  b /= 255;
  let max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max == min) {
    h = s = 0;
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  document.getElementById("color-hsl").value = `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

// ==========================================
// --- AI TOOLS (POWERED BY REAL GEMINI) ---
// ==========================================

// Language preferences for AI tools (default: id)
let currentRegexLang = 'id';
let currentCodeLang = 'id';

function setRegexLanguage(lang) {
  currentRegexLang = lang;
  const btnId = document.getElementById("regex-lang-id");
  const btnEn = document.getElementById("regex-lang-en");
  if (btnId && btnEn) {
    if (lang === 'id') {
      btnId.className = "px-2.5 py-1 rounded-lg font-bold bg-primary text-white transition-all shadow-sm";
      btnEn.className = "px-2.5 py-1 rounded-lg text-themeMuted hover:text-themeText font-medium transition-all";
    } else {
      btnEn.className = "px-2.5 py-1 rounded-lg font-bold bg-primary text-white transition-all shadow-sm";
      btnId.className = "px-2.5 py-1 rounded-lg text-themeMuted hover:text-themeText font-medium transition-all";
    }
  }
}

function setAiLanguage(lang) {
  currentCodeLang = lang;
  const btnId = document.getElementById("ai-lang-id");
  const btnEn = document.getElementById("ai-lang-en");
  if (btnId && btnEn) {
    if (lang === 'id') {
      btnId.className = "px-2.5 py-1 rounded-lg font-bold bg-primary text-white transition-all shadow-sm";
      btnEn.className = "px-2.5 py-1 rounded-lg text-themeMuted hover:text-themeText font-medium transition-all";
    } else {
      btnEn.className = "px-2.5 py-1 rounded-lg font-bold bg-primary text-white transition-all shadow-sm";
      btnId.className = "px-2.5 py-1 rounded-lg text-themeMuted hover:text-themeText font-medium transition-all";
    }
  }
}

async function handleAiRegex(e) {
  e.preventDefault();
  const prompt = document.getElementById("regex-prompt").value.trim();
  const btn = document.getElementById("btn-regex");
  const resultBox = document.getElementById("regex-result");
  const outRegex = document.getElementById("regex-output");
  const outExplain = document.getElementById("regex-explain");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Generating...`;
  btn.disabled = true;

  try {
    const data = await api.generateAiRegex(prompt, currentRegexLang);
    resultBox.classList.remove("hidden");
    outRegex.innerText = data.regex || data.pattern;
    outExplain.innerHTML = data.explanation || "Regex pattern created successfully.";
    const engineLabel = data.engine ? ` via ${data.engine}` : "";
    showToast(`Regex Generated${engineLabel}!`, "success");
  } catch (err) {
    showToast(err.message || "Failed to generate regex", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

async function handleAiCode() {
  const code = document.getElementById("ai-code-input").value.trim();
  if (!code) {
    showToast("Please paste some code to explain", "info");
    return;
  }

  const btn = document.getElementById("btn-ai-code");
  const outBox = document.getElementById("ai-code-output");

  const origBtnText = btn.innerHTML;
  btn.innerHTML = `<span class="loader w-4 h-4 mr-1"></span> Analyzing...`;
  btn.disabled = true;

  try {
    const data = await api.explainAiCode(code, currentCodeLang);
    if (typeof marked !== "undefined" && data.explanation) {
      outBox.innerHTML = marked.parse(data.explanation);
    } else {
      outBox.innerHTML = `<pre class="whitespace-pre-wrap">${data.explanation || data.result}</pre>`;
    }
    const engineLabel = data.engine ? ` (${data.engine})` : "";
    showToast(`Code Explanation Complete${engineLabel}!`, "success");
  } catch (err) {
    showToast(err.message || "Failed to explain code", "error");
  } finally {
    btn.innerHTML = origBtnText;
    btn.disabled = false;
  }
}

