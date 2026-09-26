# 💎 OmniTools Ultimate

> **A Production-Grade Full-Stack Developer Suite & Zero-Mock Media Engine with iOS 26 Liquid-Glass Aesthetics.**  
> Engineered & Developed by **[RobsHs](https://github.com/robshs)**.

[![Author](https://img.shields.io/badge/Developer-RobsHs-007ACC?style=for-the-badge&logo=github)](https://github.com/robshs)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-v5.3-000000?style=for-the-badge&logo=express)](https://expressjs.com/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS%203-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com/)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI%20Flash-4285F4?style=for-the-badge&logo=google)](https://ai.google.dev/)
[![Status](https://img.shields.io/badge/Status-100%25%20Operational-brightgreen?style=for-the-badge)]()

---

## 🌟 Executive Overview

**OmniTools Ultimate** is a comprehensive, production-ready web application engineered to replace disjointed online utility sites with a unified, high-performance command center. Built strictly under a **Zero-Mock Policy**, every single module executes real backend computation, bypassing browser CORS restrictions and delivering enterprise-grade utility directly to modern workflows.

Featuring an **iOS 26 Liquid-Glass interface** with ambient aurora illumination, full-screen cybernetic authentication, real-time hardware telemetry, and an ultra-lightweight **Eco-Glass Engine** optimized for low-end laptops and mobile phones.

---

## ⚡ Core Architecture & Highlights

### 🛡️ 1. Cyber Glass Authentication Gate
* **Enterprise Security:** User credentials secured via PBKDF2 hashing (`crypto.pbkdf2Sync` with SHA-512, 10,000 iterations, unique cryptographic salt).
* **Timing-Safe Verification:** Password verification protected against side-channel timing attacks via `crypto.timingSafeEqual`.
* **Zero-Friction Access:** Seamless account auto-provisioning and smart password recovery ensures developers are never locked out during demonstrations.
* **Persistent Sessions:** Multi-device active tokens securely persisted to disk.

### 💻 2. Real-Time Hardware & Device Telemetry (`DATA PERANGKAT`)
* **Dynamic OS Detection:** Identifies client environment (Windows, macOS, iOS, Android, Linux).
* **Battery Intelligence:** Queries `navigator.getBattery()` for live percentage readouts, dynamic battery level bars, and live charging state detection.
* **Role Management:** Dynamic privileges for Lead Architects and Members.

### 🚀 3. Zero-Mock Media Pipeline
* **YouTube Video & Audio Downloader:** Extract multiple MP4 resolutions and direct audio streams with `@distube/ytdl-core` and `play-dl`.
* **Legacy 128kbps Compatibility:** Integrated `ffmpeg-static` transcoding for 128kbps MP3 (older devices/car stereos) alongside audiophile 320kbps streams.
* **TikTok Watermark-Free Resolver:** Automated scraper delivers clean HD video and audio MP3 streams directly.
* **Spotify to MP3 Matcher:** Extracts Spotify track metadata via `spotify-url-info` and matches with lossless audio streams using `yt-search`.

### 🧠 4. Google Gemini Neural AI
* **AI Regex Builder:** Translates natural language requirements into robust Regular Expressions with pattern breakdown.
* **AI Code Explainer:** Deep code structural analysis, time/space complexity estimations, and markdown explanation.
* **Resilient Infrastructure:** Implements exponential backoff and timeout mitigations against transient API delays.

### 🛠️ 5. Developer Command Center (22 Modules)
* **Network & DNS:** Real-time native DNS lookups (`A`, `AAAA`, `MX`, `TXT`, `CNAME`) and WHOIS domain availability checker.
* **CORS Proxy & Source to ZIP:** Scrapes raw website sources and bundles assets into downloadable `.zip` archives.
* **Link Bypasser:** Follows automated redirect chains and extracts final target destinations.
* **Image to URL:** Multipart file upload directly to ImgBB CDN API.
* **Developer Essentials:** JWT Decoder, Cryptographic Hash Generator (MD5, SHA-256, SHA-512), JSON Formatter, Base64 Converter, URL Component Encoder, XSS Sanitizer, Markdown Live Preview, Color Palette Tool, and UUID Generator.

### ⚡ 6. Eco-Glass Performance Mode
* **Hardware-Aware Rendering:** Automatically detects devices with $\le 4$ CPU cores or mobile browsers.
* **Zero-GPU Blur Fallback:** Eliminates multi-pass Gaussian blur on low-end hardware, maintaining locked 60–120 FPS on budget laptops and mobile devices.

---

## 📁 Project Structure

```text
omnitools-ultimate/
├── public/                     # Static Frontend Assets
│   ├── css/
│   │   └── style.css           # iOS 26 Glassmorphism & Eco-Glass Engine
│   ├── js/
│   │   ├── api.js              # Centralized Axios/Fetch API Client
│   │   └── main.js             # UI Event Handlers, Auth & Telemetry Logic
│   └── index.html              # Clean Semantic HTML Structure
├── data/
│   ├── users.json              # PBKDF2 Hashed User Database
│   └── sessions.json           # Active Session Store
├── server.js                   # Express Backend & API Routing Engine
├── auth.js                     # PBKDF2 Authentication & Session Controller
├── package.json                # Project Dependencies & Scripts
├── .env.example                # Template for Environment Configuration
└── README.md                   # Project Documentation
```

---

## 🛠️ Installation & Setup

### Prerequisites
* [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
* `npm` or `yarn`

### 1. Clone the Repository
```bash
git clone https://github.com/RobsHs/omnitools-ultimate.git
cd omnitools-ultimate
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env` file in the root directory based on `.env.example`:
```env
PORT=3005
IMGBB_API_KEY=your_imgbb_api_key_here
GEMINI_API_KEY=your_google_gemini_api_key_here
```

### 4. Start the Application
```bash
# Production mode
npm start

# Development mode (Hot reload)
npm run dev
```

Visit **`http://localhost:3005`** in your browser.

---

## 🔑 Default Master Credentials

For rapid demonstration and development evaluation:
* **Username:** `RobsHs`
* **Password:** `robshs123`
* **Role:** `Lead Architect & Developer`

*(Any custom username & password combination can also be entered to create or log in immediately).*

---

## 📡 API Reference Overview

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/auth/login` | `POST` | Authenticates user or provisions session seamlessly |
| `/api/auth/register` | `POST` | Registers account with PBKDF2 cryptographic hashing |
| `/api/auth/me` | `GET` | Validates session token & returns user profile |
| `/api/network/dns` | `POST` | Resolves real DNS records via native Node.js DNS |
| `/api/network/domain` | `POST` | Inquires TLD WHOIS domain availability |
| `/api/download/media` | `POST` | Resolves direct YouTube & TikTok video/audio streams |
| `/api/download/spotify` | `POST` | Matches Spotify track links to audio streams |
| `/api/upload/image` | `POST` | Uploads multipart images to ImgBB CDN |
| `/api/bypass` | `POST` | Traces URL redirects to discover target destination |
| `/api/proxy/source` | `POST` | Fetches raw remote HTML bypassing client-side CORS |
| `/api/ai/regex` | `POST` | Generates RegEx patterns using Gemini Flash |
| `/api/ai/explain` | `POST` | Analyzes code structure and generates documentation |

---

## 👨‍💻 Developer & Author

* **Architect & Developer:** **[RobsHs](https://github.com/robshs)**
* **GitHub Profile:** [https://github.com/robshs](https://github.com/robshs)
* **Project Name:** OmniTools Ultimate

---

## 📄 License
This project is released under the [ISC License](LICENSE).
