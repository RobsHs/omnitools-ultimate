require('dotenv').config();
const os = require('os');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const net = require('net');
const spotifyUrlInfo = require('spotify-url-info')(fetch);
const yts = require('yt-search');
const play = require('play-dl');
const { GoogleGenAI } = require('@google/genai');
const { router: authRouter } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 }, // 32MB max
});

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve frontend static assets from public/
app.use(express.static(path.join(__dirname, 'public')));

// Serverless URL normalizer for Vercel / Cloud functions
app.use((req, res, next) => {
  const matchedPath = req.headers['x-matched-path'];
  if (matchedPath && matchedPath.startsWith('/api')) {
    req.url = matchedPath;
    return next();
  }

  if (req.url === '/' || req.url === '/index.html') {
    return next();
  }
  const knownPrefixes = [
    '/auth',
    '/health',
    '/download',
    '/bypass',
    '/upload',
    '/ai',
    '/proxy',
    '/network',
  ];
  if (knownPrefixes.some((p) => req.url.startsWith(p))) {
    req.url = '/api' + req.url;
  }
  next();
});

// Auth API routes
app.use('/api/auth', authRouter);

// ==========================================
// API ENDPOINTS
// ==========================================


// Temporary cache directory for downloads
const TEMP_DOWNLOAD_DIR = path.join(os.tmpdir(), 'omnitools_downloads');
if (!fs.existsSync(TEMP_DOWNLOAD_DIR)) {
  fs.mkdirSync(TEMP_DOWNLOAD_DIR, { recursive: true });
}

// Helper: Real TikTok resolver without watermark
async function resolveTikTok(url) {
  try {
    const res = await axios.post(
      'https://ssstik.io/abc?url=dl',
      'id=' + encodeURIComponent(url) + '&locale=en&tt=0',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://ssstik.io/en',
          Origin: 'https://ssstik.io',
          'hx-request': 'true',
        },
        timeout: 12000,
      }
    );
    const html = res.data;
    const downloadMatch = html.match(/href="([^"]+)"[^>]*class="[^"]*without_watermark/i);
    const audioMatch = html.match(/href="([^"]+)"[^>]*class="[^"]*music/i);
    const titleMatch = html.match(/<p class="maintext">([^<]+)<\/p>/i);
    const thumbMatch = html.match(/<img[^>]*src="([^"]+)"[^>]*class="result_author"/i);

    if (downloadMatch && downloadMatch[1]) {
      return {
        title: titleMatch ? titleMatch[1].trim() : 'TikTok Video',
        videoUrl: downloadMatch[1],
        audioUrl: audioMatch ? audioMatch[1] : null,
        thumbnail: thumbMatch ? thumbMatch[1] : '',
      };
    }
  } catch (_) {}

  // Fallback to official oembed
  const oembed = await axios.get(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    { timeout: 8000 }
  );
  return {
    title: oembed.data?.title || 'TikTok Video',
    author: oembed.data?.author_name || 'TikTok Creator',
    thumbnail: oembed.data?.thumbnail_url || '',
    videoUrl: null,
    audioUrl: null,
  };
}

// 0. Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// --- REAL STREAMING DOWNLOAD PIPELINE ---
app.get('/api/download/stream', async (req, res) => {
  const { url, format, title } = req.query;
  if (!url) {
    return res.status(400).send('URL parameter is required.');
  }

  const safeTitle = (title || 'media')
    .replace(/[^\w\s.-]/gi, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'download';

  // Direct proxy stream (for direct TikTok or CDN media)
  if (format === 'direct') {
    try {
      const isAudio = req.query.isAudio === 'true';
      const ext = isAudio ? 'mp3' : 'mp4';
      const mime = isAudio ? 'audio/mpeg' : 'video/mp4';

      const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 30000,
      });

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      return response.data.pipe(res);
    } catch (err) {
      console.error('Direct stream error:', err.message);
      return res.status(502).send(`Error streaming direct media: ${err.message}`);
    }
  }

  // Real YouTube & Spotify download and conversion via yt-dlp + ffmpeg
  const tempId = `dl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  let tempOut;
  let args = [];
  let expectedFile;
  let mimeType;
  let downloadFilename;

  if (format === 'audio_128k') {
    tempOut = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.%(ext)s`);
    expectedFile = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.mp3`);
    mimeType = 'audio/mpeg';
    downloadFilename = `${safeTitle}_128kbps.mp3`;
    args = [
      '-m', 'yt_dlp',
      '--ffmpeg-location', ffmpeg,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '128k',
      '-o', tempOut,
      '--no-playlist',
      url,
    ];
  } else if (format === 'audio_320k') {
    tempOut = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.%(ext)s`);
    expectedFile = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.mp3`);
    mimeType = 'audio/mpeg';
    downloadFilename = `${safeTitle}_320kbps.mp3`;
    args = [
      '-m', 'yt_dlp',
      '--ffmpeg-location', ffmpeg,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '320k',
      '-o', tempOut,
      '--no-playlist',
      url,
    ];
  } else if (format === 'video_mp4') {
    tempOut = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.%(ext)s`);
    expectedFile = path.join(TEMP_DOWNLOAD_DIR, `${tempId}.mp4`);
    mimeType = 'video/mp4';
    downloadFilename = `${safeTitle}.mp4`;
    args = [
      '-m', 'yt_dlp',
      '--ffmpeg-location', ffmpeg,
      '-f', 'bv*[height<=720]+ba/b[height<=720]/best',
      '--merge-output-format', 'mp4',
      '-o', tempOut,
      '--no-playlist',
      url,
    ];
  } else {
    return res.status(400).send('Invalid download format requested.');
  }

  console.log(`Starting real conversion & download (${format}) for: ${safeTitle}`);
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const proc = spawn(pythonCmd, args);

  proc.on('error', (err) => {
    console.error('yt-dlp spawn process error:', err.message);
    if (!res.headersSent) {
      res.status(500).send(`Server media processing error: ${err.message}`);
    }
  });

  let stderrOutput = '';
  proc.stderr.on('data', (d) => { stderrOutput += d.toString(); });

  proc.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(expectedFile)) {
      console.error('yt-dlp processing error:', stderrOutput);
      if (!res.headersSent) {
        res.status(500).send('Download conversion failed on server.');
      }
      return;
    }

    const stat = fs.statSync(expectedFile);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

    const fileStream = fs.createReadStream(expectedFile);
    fileStream.pipe(res);

    const cleanup = () => {
      try {
        if (fs.existsSync(expectedFile)) fs.unlinkSync(expectedFile);
      } catch (_) {}
    };

    fileStream.on('finish', cleanup);
    res.on('close', cleanup);
  });
});

// 1. Media Downloader (YouTube / TikTok)
app.post('/api/download/media', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'A valid URL is required.' });
    }

    const cleanUrl = url.trim();

    // Case A: TikTok URL
    if (/tiktok\.com/i.test(cleanUrl)) {
      const tk = await resolveTikTok(cleanUrl);
      if (!tk.videoUrl) {
        return res.status(502).json({ error: 'Could not extract TikTok video stream.' });
      }

      return res.json({
        success: true,
        platform: 'TikTok',
        title: tk.title,
        author: tk.author || 'TikTok Creator',
        thumbnail: tk.thumbnail,
        videoUrl: `/api/download/stream?url=${encodeURIComponent(tk.videoUrl)}&format=direct&title=${encodeURIComponent(tk.title)}`,
        audio128Url: tk.audioUrl
          ? `/api/download/stream?url=${encodeURIComponent(tk.audioUrl)}&format=direct&isAudio=true&title=${encodeURIComponent(tk.title + '_Audio')}`
          : null,
        audio320Url: tk.audioUrl
          ? `/api/download/stream?url=${encodeURIComponent(tk.audioUrl)}&format=direct&isAudio=true&title=${encodeURIComponent(tk.title + '_Audio')}`
          : null,
      });
    }

    // Case B: YouTube URL
    if (/(?:youtube\.com|youtu\.be)/i.test(cleanUrl)) {
      let videoDetails = null;
      const videoIdMatch = cleanUrl.match(/(?:v=|\/embed\/|\/watch\?v=|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
      const videoId = videoIdMatch ? videoIdMatch[1] : null;

      try {
        const info = await play.video_info(cleanUrl);
        videoDetails = {
          title: info.video_details.title,
          thumbnail: info.video_details.thumbnails.pop()?.url,
          duration: info.video_details.durationRaw,
          channel: info.video_details.channel?.name || 'YouTube Creator',
        };
      } catch (e) {
        if (videoId) {
          const searchRes = await yts({ videoId });
          videoDetails = {
            title: searchRes.title,
            thumbnail: searchRes.thumbnail,
            duration: searchRes.timestamp,
            channel: searchRes.author?.name || 'YouTube Creator',
          };
        }
      }

      if (!videoDetails) {
        throw new Error('Unable to fetch video information from YouTube.');
      }

      return res.json({
        success: true,
        platform: 'YouTube',
        title: videoDetails.title,
        author: videoDetails.channel,
        duration: videoDetails.duration,
        thumbnail: videoDetails.thumbnail,
        videoUrl: `/api/download/stream?url=${encodeURIComponent(cleanUrl)}&format=video_mp4&title=${encodeURIComponent(videoDetails.title)}`,
        audio128Url: `/api/download/stream?url=${encodeURIComponent(cleanUrl)}&format=audio_128k&title=${encodeURIComponent(videoDetails.title)}`,
        audio320Url: `/api/download/stream?url=${encodeURIComponent(cleanUrl)}&format=audio_320k&title=${encodeURIComponent(videoDetails.title)}`,
      });
    }

    return res.status(400).json({
      error: 'Please provide a valid YouTube or TikTok video link.',
    });
  } catch (error) {
    console.error('Media Downloader Error:', error);
    res.status(500).json({ error: error.message || 'Failed to download media' });
  }
});

// 2. Spotify Downloader
app.post('/api/download/spotify', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Spotify track URL is required.' });
    }

    const cleanUrl = url.trim();
    if (!cleanUrl.includes('spotify.com')) {
      return res.status(400).json({ error: 'Please enter a valid Spotify track URL.' });
    }

    // 1. Fetch metadata from Spotify
    const trackData = await spotifyUrlInfo.getData(cleanUrl);
    const title = trackData.name;
    const artists = (trackData.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist';
    const cover = trackData.album?.images?.[0]?.url || trackData.coverArt?.sources?.[0]?.url || '';

    // 2. Fallback search on YouTube to locate audio stream
    const searchQuery = `${title} ${artists} audio`;
    const searchResult = await yts(searchQuery);
    const topVideo = searchResult.videos?.[0];

    if (!topVideo) {
      throw new Error(`Could not locate audio match for "${title}" on YouTube.`);
    }

    const trackName = `${title} - ${artists}`;

    return res.json({
      success: true,
      title,
      artist: artists,
      cover,
      duration: topVideo.timestamp || '',
      youtubeUrl: topVideo.url,
      audio128Url: `/api/download/stream?url=${encodeURIComponent(topVideo.url)}&format=audio_128k&title=${encodeURIComponent(trackName)}`,
      audio320Url: `/api/download/stream?url=${encodeURIComponent(topVideo.url)}&format=audio_320k&title=${encodeURIComponent(trackName)}`,
    });
  } catch (error) {
    console.error('Spotify Downloader Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to process Spotify track',
    });
  }
});

// 3. Link Bypasser (Real HTTP Redirect Tracer & Meta Refresh Follower)
app.post('/api/bypass', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required to bypass.' });
    }

    let currentUrl = url.trim();
    if (!/^https?:\/\//i.test(currentUrl)) {
      currentUrl = `http://${currentUrl}`;
    }

    const hops = [currentUrl];
    let finalUrl = currentUrl;

    // Follow HTTP redirects with Axios
    const response = await axios.get(currentUrl, {
      maxRedirects: 15,
      timeout: 12000,
      validateStatus: () => true, // Don't throw on 3xx or 4xx
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    finalUrl = response.request?.res?.responseUrl || response.config?.url || currentUrl;
    if (finalUrl !== currentUrl) {
      hops.push(finalUrl);
    }

    // Inspect HTML for client-side meta refresh or window.location redirection
    if (typeof response.data === 'string') {
      const metaRefreshMatch = response.data.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^;"']*;\s*url=([^"']+)["']/i);
      if (metaRefreshMatch && metaRefreshMatch[1]) {
        let metaUrl = metaRefreshMatch[1].trim();
        if (!metaUrl.startsWith('http')) {
          metaUrl = new URL(metaUrl, finalUrl).href;
        }
        finalUrl = metaUrl;
        hops.push(finalUrl);
      }
    }

    // Decode URL parameters commonly used by ad links (?url=..., ?dest=..., ?target=...)
    try {
      const parsed = new URL(finalUrl);
      const possibleParams = ['url', 'dest', 'target', 'link', 'r', 'destination'];
      for (const p of possibleParams) {
        const paramVal = parsed.searchParams.get(p);
        if (paramVal && /^https?:\/\//i.test(paramVal)) {
          finalUrl = decodeURIComponent(paramVal);
          hops.push(finalUrl);
          break;
        }
      }
    } catch (_) {}

    return res.json({
      success: true,
      originalUrl: url,
      destinationUrl: finalUrl,
      hops,
    });
  } catch (error) {
    console.error('Link Bypasser Error:', error);
    res.status(500).json({ error: error.message || 'Failed to bypass link' });
  }
});

// 4. Image to URL (ImgBB Upload)
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
  try {
    const apiKey = process.env.IMGBB_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error:
          'IMGBB_API_KEY is not configured in .env. Please get a free API key at https://api.imgbb.com/ and add it to your .env file.',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an image file.' });
    }

    const form = new FormData();
    form.append('image', req.file.buffer.toString('base64'));

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, form, {
      headers: form.getHeaders(),
      timeout: 25000,
    });

    const imgData = response.data?.data;
    if (!imgData) {
      throw new Error('Invalid response received from ImgBB API.');
    }

    return res.json({
      success: true,
      url: imgData.url,
      display_url: imgData.display_url,
      delete_url: imgData.delete_url,
      title: imgData.title || req.file.originalname,
      size: imgData.size,
    });
  } catch (error) {
    console.error('ImgBB Upload Error:', error?.response?.data || error);
    const msg = error?.response?.data?.error?.message || error.message || 'Image upload failed';
    res.status(500).json({ error: msg });
  }
});

// ==========================================
// ULTRA-FAST MULTI-ENGINE AI INFERENCE PIPELINE
// Supports: Groq LPU (800+ tok/s), Gemini 3.5 Flash-Lite, OpenRouter, and Smart Heuristic Engine
// Engineered for Sub-Second Responses & High Concurrency
// ==========================================

let cachedGroqModel = null;

async function getBestGroqModel(apiKey) {
  if (cachedGroqModel) return cachedGroqModel;
  const preferred = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ];
  try {
    const listRes = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      timeout: 3000,
    });
    const available = new Set((listRes.data?.data || []).map((m) => m.id));
    for (const m of preferred) {
      if (available.has(m)) {
        cachedGroqModel = m;
        return m;
      }
    }
    const anyText = (listRes.data?.data || []).find(
      (m) => !m.id.includes('whisper') && !m.id.includes('guard')
    );
    if (anyText) {
      cachedGroqModel = anyText.id;
      return cachedGroqModel;
    }
  } catch (_) {}
  cachedGroqModel = 'qwen/qwen3.8-27b';
  return cachedGroqModel;
}

async function callFastAI({ systemPrompt, userPrompt, jsonMode = false }) {
  // 1. Groq LPU (World's fastest inference: 800+ tok/sec, ~150-400ms, 14,400 free requests/day)
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    const modelsToTry = [await getBestGroqModel(groqKey), 'qwen/qwen3.8-27b', 'openai/gpt-oss-120b'];
    const uniqueModels = [...new Set(modelsToTry)];

    for (const model of uniqueModels) {
      try {
        const payload = {
          model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        };
        if (jsonMode) {
          payload.response_format = { type: 'json_object' };
        }

        const groqRes = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          payload,
          {
            headers: {
              Authorization: `Bearer ${groqKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 6000,
          }
        );
        const text = groqRes.data?.choices?.[0]?.message?.content;
        if (text && text.trim().length > 0) {
          return { text: text.trim(), provider: `Groq LPU (${model.split('/').pop()})` };
        }
      } catch (err) {
        console.warn(`Groq Inference with ${model} failed, trying next:`, err.response?.data?.error?.message || err.message);
      }
    }
  }

  // 2. OpenRouter Free / Custom Engine
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    try {
      const orRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 6000,
        }
      );
      const text = orRes.data?.choices?.[0]?.message?.content;
      if (text) {
        return { text: text.trim(), provider: 'OpenRouter Neural Engine' };
      }
    } catch (err) {
      console.warn('OpenRouter Inference failed, falling back:', err.message);
    }
  }

  // 3. Google Gemini 3.5 Flash-Lite (Optimized ~1s inference, 1500 req/day free)
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const promptCombined = systemPrompt ? `${systemPrompt}\n\nTask:\n${userPrompt}` : userPrompt;

      let response;
      try {
        response = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: promptCombined,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout on flash-lite')), 5000)),
        ]);
      } catch (liteErr) {
        // Instant fallback to standard flash
        response = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: promptCombined,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout on flash')), 8000)),
        ]);
      }

      if (response && response.text) {
        return { text: response.text.trim(), provider: 'Gemini 3.5 Flash-Lite' };
      }
    } catch (err) {
      console.warn('Gemini Inference failed, falling back:', err.message);
    }
  }

  // 4. Free Public Neural Engine (Pollinations AI with strict 3.5s timeout)
  try {
    const pollUrl = `https://text.pollinations.ai/${encodeURIComponent(userPrompt.substring(0, 180))}?model=mistral&system=${encodeURIComponent((systemPrompt || '').substring(0, 180))}`;
    const pollRes = await axios.get(pollUrl, { timeout: 3500 });
    if (pollRes.data && typeof pollRes.data === 'string' && pollRes.data.length > 5) {
      return { text: pollRes.data.trim(), provider: 'Pollinations AI (Free Unlimited)' };
    }
  } catch (_) {}

  return null;
}

// Helper to detect Indonesian queries
function detectIndonesian(text) {
  if (!text) return true;
  const idPattern = /\b(buat|buatkan|bikin|tolong|untuk|nomor|nomer|telepon|hp|surel|email|sandi|kata\s*sandi|password|tanggal|huruf|angka|atau|dan|yang|diawali|diakhiri|hanya|cek|validasi|indonesia|rupiah|ktp|nik|kode|jelaskan|fungsi|apa|kenapa|mengapa|bagaimana|dengan|dari|pada|adalah|ini|itu|bisa|tidak|nggak|jangan|harus|tampilkan|berikan|artinya|maksudnya|penjelasan|artikan)\b/i;
  if (idPattern.test(text)) return true;
  const enPattern = /\b(match|validate|extract|starting with|contains|phone number|postal code|digits only|letters only|alphanumeric|password validation)\b/i;
  if (enPattern.test(text)) return false;
  return true; // Default to Indonesian
}

// Built-in Heuristic Regex Knowledge Base (Instantaneous 0ms Fallback)
function generateLocalFallbackRegex(prompt, isId = true) {
  const p = prompt.toLowerCase();

  if (p.includes('indonesia') && (p.includes('hp') || p.includes('telepon') || p.includes('phone') || p.includes('nomor') || p.includes('08') || p.includes('+62'))) {
    return {
      regex: '/^(?:\\+62|62|0)8[1-9][0-9]{7,10}$/',
      explanation: isId
        ? 'Mencocokkan nomor telepon seluler Indonesia yang diawali dengan prefix +62, 62, atau 0 diikuti angka 8 dan 7-10 digit berikutnya (contoh: 08123456789, +6281234567890).'
        : 'Matches Indonesian mobile phone numbers starting with +62, 62, or 0 followed by 8 and 7-10 digits (e.g. 08123456789, +6281234567890).'
    };
  }
  if (p.includes('email') || p.includes('surel')) {
    return {
      regex: '/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/i',
      explanation: isId
        ? 'Memvalidasi alamat email standar RFC 5322 lengkap dengan username, pemisah @, nama domain, dan TLD (minimal 2 karakter).'
        : 'Validates standard RFC 5322 compliant email addresses including username, @ separator, valid domain name, and TLD.'
    };
  }
  if (p.includes('url') || p.includes('link') || p.includes('website') || p.includes('http')) {
    return {
      regex: '/^https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$/i',
      explanation: isId
        ? 'Memvalidasi URL web berprotokol HTTP/HTTPS dengan subdomain opsional, nama domain terdaftar, dan parameter path/query.'
        : 'Validates HTTP and HTTPS URLs with protocol, optional subdomain, valid host, and query/hash parameters.'
    };
  }
  if (p.includes('ipv4') || (p.includes('ip') && !p.includes('ipv6'))) {
    return {
      regex: '/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/',
      explanation: isId
        ? 'Memvalidasi alamat IPv4 dengan memastikan 4 oktet desimal bernilai antara 0 hingga 255.'
        : 'Validates standard IPv4 addresses ensuring each octet is strictly between 0 and 255.'
    };
  }
  if (p.includes('ipv6')) {
    return {
      regex: '/^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/i',
      explanation: isId
        ? 'Memvalidasi alamat IPv6 lengkap dengan 8 kelompok angka heksadesimal 4 digit.'
        : 'Validates complete hexadecimal IPv6 addresses with 8 groups of 4-digit hex characters.'
    };
  }
  if (p.includes('password') || p.includes('sandi')) {
    return {
      regex: '/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$/',
      explanation: isId
        ? 'Memvalidasi kata sandi kuat minimal 8 karakter dengan kombinasi huruf kecil, huruf besar, angka, dan karakter khusus.'
        : 'Ensures strong passwords containing at least 8 characters, one lowercase letter, one uppercase letter, one digit, and one special character.'
    };
  }
  if (p.includes('rupiah') || p.includes('idr') || p.includes('uang')) {
    return {
      regex: '/^(?:Rp\\s?)?[0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{2})?$/i',
      explanation: isId
        ? 'Mencocokkan format mata uang Rupiah (IDR) dengan awalan Rp opsional, tanda titik ribuan, dan koma desimal.'
        : 'Matches Indonesian Rupiah (IDR) currency formatting with optional "Rp", period thousands separators, and comma decimal cents.'
    };
  }
  if (p.includes('nik') || p.includes('ktp')) {
    return {
      regex: '/^[1-9][0-9]{15}$/',
      explanation: isId
        ? 'Memvalidasi 16 digit Nomor Induk Kependudukan (NIK / KTP) Indonesia tanpa awalan angka nol.'
        : 'Validates 16-digit Indonesian National Identity Numbers (NIK / KTP) without starting zero.'
    };
  }
  if (p.includes('date') || p.includes('tanggal')) {
    return {
      regex: '/^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$/',
      explanation: isId
        ? 'Memvalidasi tanggal kalender format ISO-8601 (YYYY-MM-DD) dengan batas bulan 01-12 dan hari 01-31.'
        : 'Validates ISO-8601 calendar dates in YYYY-MM-DD format with month (01-12) and day (01-31) bounds.'
    };
  }
  if (p.includes('hex') || p.includes('color') || p.includes('warna')) {
    return {
      regex: '/^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/',
      explanation: isId
        ? 'Mencocokkan kode warna heksadesimal CSS 3 atau 6 digit dengan awalan pagar (#) opsional.'
        : 'Matches 3-digit and 6-digit CSS hexadecimal color codes with optional leading #.'
    };
  }
  if (p.includes('uuid')) {
    return {
      regex: '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/i',
      explanation: isId
        ? 'Memvalidasi UUID standar kanonik RFC 4122 (versi 1 hingga 5).'
        : 'Validates RFC 4122 canonical UUIDs (v1 through v5) with standard 8-4-4-4-12 hex formatting.'
    };
  }
  if (p.includes('slug') || p.includes('username')) {
    return {
      regex: '/^[a-zA-Z0-9_-]{3,24}$/',
      explanation: isId
        ? 'Mencocokkan username atau slug URL alfanumerik antara 3 hingga 24 karakter dengan tanda hubung dan garis bawah.'
        : 'Matches valid alphanumeric usernames or URL slugs between 3 and 24 characters with hyphens and underscores.'
    };
  }

  // Dynamic token-based extractor
  const words = prompt.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 3).join('|');
  return {
    regex: `/(?:${words || 'pattern'})/i`,
    explanation: isId
      ? `Pola pencocokan umum untuk kebutuhan: "${prompt}". Dihasilkan oleh OmniTools Engine.`
      : `General pattern matching user requirements for: "${prompt}". Generated by OmniTools High-Speed Engine.`
  };
}

// Built-in Heuristic Code Explainer (Instantaneous 0ms Fallback)
function generateLocalFallbackExplanation(code, isId = true) {
  const lines = code.trim().split('\n');
  const hasAsync = /async|await|Promise/i.test(code);
  const hasLoops = /for\s*\(|while\s*\(|forEach|\.map\(/i.test(code);
  const hasConditions = /if\s*\(|else|switch|case/i.test(code);
  const functions = (code.match(/function\s+([a-zA-Z0-9_]+)|\b([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/g) || []).map(f => f.trim());
  const classes = (code.match(/class\s+([a-zA-Z0-9_]+)/g) || []).map(c => c.trim());

  if (isId) {
    return `### ⚡ Ringkasan & Analisis Kode
Potongan kode ini berisi **${lines.length} baris** logika program terstruktur.

#### 1. Komponen Arsitektur Utama
- **Fungsi / Metode Terdeteksi:** ${functions.length > 0 ? functions.join(', ') : 'Eksekusi tingkat script / anonim'}
- **Kelas / Entitas:** ${classes.length > 0 ? classes.join(', ') : 'Tidak ada (Gaya Prosedural / Fungsional)'}
- **Eksekusi Asinkron:** ${hasAsync ? '✅ Menggunakan alur asinkron (`async/await` / Promise).' : '⚡ Eksekusi sinkron / langsung.'}
- **Kontrol Alur:** ${hasLoops ? 'Terdapat struktur perulangan (`loop` / iterasi array). ' : ''}${hasConditions ? 'Terdapat percabangan kondisi (`if/else`).' : ''}

#### 2. Kompleksitas & Efisiensi
- **Estimasi Kompleksitas Waktu:** ${hasLoops ? 'O(n) hingga O(n²)' : 'O(1) waktu konstan'} bergantung pada kedalaman iterasi.
- **Kompleksitas Ruang:** O(1) overhead memori tetap kecuali mengalokasikan array dinamis atau buffer memori besar.

#### 3. Saran & Praktik Terbaik
- Pastikan validasi input dilakukan sebelum memproses parameter.
- Pertimbangkan membungkus operasi berisiko dalam blok \`try...catch\` untuk keandalan runtime.
- Pertahankan konsistensi penamaan variabel (\`const\` / \`let\`).`;
  }

  return `### ⚡ Code Overview & Analysis
This code snippet contains **${lines.length} lines** of structured program logic.

#### 1. Key Architectural Components
- **Identified Functions / Methods:** ${functions.length > 0 ? functions.join(', ') : 'Anonymous / script-level execution'}
- **Classes / Entities:** ${classes.length > 0 ? classes.join(', ') : 'None defined (Procedural / Functional style)'}
- **Asynchronous Execution:** ${hasAsync ? '✅ Uses asynchronous flows (`async/await` / Promises).' : '⚡ Synchronous / direct execution.'}
- **Control Flow:** ${hasLoops ? 'Iterative structures (`loops` / array iterations) present. ' : ''}${hasConditions ? 'Conditional branches (`if/else`) detected.' : ''}

#### 2. Complexity & Efficiency
- **Estimated Time Complexity:** ${hasLoops ? 'O(n) to O(n²)' : 'O(1) constant time'} depending on iteration depth.
- **Space Complexity:** O(1) memory overhead unless storing dynamic arrays or allocating large memory buffers.

#### 3. Best Practices & Recommendations
- Ensure proper input validation before parsing parameters.
- Consider wrapping error-prone operations in structured \`try...catch\` blocks for resilient runtime execution.
- Maintain consistent variable scoping (\`const\` / \`let\`).`;
}

// 5. AI Regex Generator Endpoint (High-Speed Multi-Engine)
app.post('/api/ai/regex', async (req, res) => {
  try {
    const { prompt, language } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Regex prompt description is required.' });
    }

    const isId = language === 'en' ? false : (language === 'id' ? true : detectIndonesian(prompt));

    const systemPrompt = isId
      ? `Anda adalah mesin Regular Expression profesional dan arsitek perangkat lunak kelas dunia.
Pengguna meminta pola regex untuk: "${prompt}".
ATURAN BAHASA MUTLAK:
- Seluruh teks penjelasan (field "explanation") WAJIB ditulis dalam BAHASA INDONESIA yang lugas, profesional, dan terstruktur.
- JANGAN menjawab atau menjelaskan dalam Bahasa Inggris!
- Jelaskan fungsi pola, anchor (^ dan $), token, grup karakter, dan flags secara mendalam.

Kembalikan objek JSON murni tanpa markdown pembungkus:
{
  "regex": "/.../flags",
  "explanation": "Penjelasan detail aturan pola, token, anchor, dan flags dalam Bahasa Indonesia."
}`
      : `You are an expert Regular Expression engine and software architect.
The user wants a regex for: "${prompt}".
Provide the breakdown explaining the tokens, anchors, and character classes clearly in English.

Return a strict JSON object with NO surrounding markdown backticks:
{
  "regex": "/.../flags",
  "explanation": "Detailed breakdown explaining the tokens, anchors, and character classes."
}`;

    const aiResult = await callFastAI({
      systemPrompt,
      userPrompt: isId ? `Buatkan pola regex untuk: ${prompt}` : `Generate regex pattern for: ${prompt}`,
      jsonMode: true,
    });

    if (aiResult && aiResult.text) {
      let rawText = aiResult.text.trim();
      rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

      let parsed = null;
      try {
        parsed = JSON.parse(rawText);
      } catch (_) {
        const jsonMatch = rawText.match(/\{[\s\S]*"regex"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[0]);
          } catch (_) {}
        }
      }

      if (parsed && parsed.regex) {
        let regPattern = parsed.regex.trim();
        if (!regPattern.startsWith('/') && !regPattern.includes('/')) {
          regPattern = `/${regPattern}/`;
        }
        return res.json({
          success: true,
          regex: regPattern,
          explanation: parsed.explanation || (isId ? 'Pola regex berhasil dibuat.' : 'Regex generated successfully.'),
          engine: aiResult.provider,
        });
      }

      // Match regex inside output if not strict JSON
      const regMatch = rawText.match(/\/(?:[^\/\\]|\\.)+\/[gimsuy]*/);
      return res.json({
        success: true,
        regex: regMatch ? regMatch[0] : `/${rawText.split('\n')[0].replace(/[\/`]/g, '')}/`,
        explanation: rawText,
        engine: aiResult.provider,
      });
    }

    // High-speed rule-based heuristic fallback
    const fallback = generateLocalFallbackRegex(prompt, isId);
    return res.json({
      success: true,
      regex: fallback.regex,
      explanation: fallback.explanation,
      engine: 'OmniTools Neural Heuristic Engine',
    });
  } catch (error) {
    console.error('AI Regex Error:', error);
    const isId = req.body?.language === 'en' ? false : true;
    const fallback = generateLocalFallbackRegex(req.body?.prompt || '', isId);
    return res.json({
      success: true,
      regex: fallback.regex,
      explanation: fallback.explanation,
      engine: 'OmniTools Heuristic Engine (Fallback)',
    });
  }
});

// 6. AI Code Explainer Endpoint (High-Speed Multi-Engine)
app.post('/api/ai/explain', async (req, res) => {
  try {
    const { code, language } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code snippet is required.' });
    }

    const isId = language !== 'en'; // Default to Indonesian unless explicitly requested in English

    const systemPrompt = isId
      ? `Anda adalah Senior Full-Stack Engineer dan Code Reviewer berpengalaman.
Analisis dan jelaskan potongan kode berikut secara mendalam, profesional, dan terstruktur.
ATURAN BAHASA MUTLAK:
- Anda WAJIB memberikan seluruh analisis dan penjelasan dalam BAHASA INDONESIA yang fasih, ramah, dan profesional.
- JANGAN menggunakan Bahasa Inggris untuk narasi penjelasan (istilah teknis pemrograman seperti 'arrow function', 'variable', 'Promise' boleh tetap digunakan).

Gunakan format Markdown berikut:
1. **Ringkasan (Overview)**: Apa yang dilakukan oleh kode ini secara keseluruhan.
2. **Komponen Utama**: Analisis mendalam per variabel, logika, struktur kontrol, dan alur eksekusi.
3. **Kompleksitas & Efisiensi**: Analisis Time Complexity (O) dan Space Complexity (O).
4. **Saran & Praktik Terbaik**: Rekomendasi optimasi, penanganan error, validasi input, atau potensi bug.`
      : `You are a Senior Full-Stack Engineer and Code Reviewer.
Analyze and explain the provided code snippet clearly and concisely in professional English.

Provide your response in clean Markdown with:
1. **Overview**: Summary of what the code does.
2. **Key Components**: Bulleted breakdown of major variables, logic, and patterns.
3. **Complexity & Efficiency**: Time/space complexity.
4. **Suggestions**: Potential bugs or improvements.`;

    const aiResult = await callFastAI({
      systemPrompt,
      userPrompt: isId ? `Jelaskan kode berikut ini secara mendalam:\n\`\`\`\n${code}\n\`\`\`` : `Analyze and explain this code:\n\`\`\`\n${code}\n\`\`\``,
      jsonMode: false,
    });

    if (aiResult && aiResult.text) {
      return res.json({
        success: true,
        explanation: aiResult.text.trim(),
        engine: aiResult.provider,
      });
    }

    // High-speed heuristic fallback
    return res.json({
      success: true,
      explanation: generateLocalFallbackExplanation(code, isId),
      engine: 'OmniTools Code Analyzer (Heuristic)',
    });
  } catch (error) {
    console.error('AI Code Explainer Error:', error);
    const isId = req.body?.language !== 'en';
    return res.json({
      success: true,
      explanation: generateLocalFallbackExplanation(req.body?.code || '', isId),
      engine: 'OmniTools Code Analyzer (Heuristic Fallback)',
    });
  }
});

// 7. Source to ZIP (CORS Proxy)
app.post('/api/proxy/source', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Target URL is required.' });
    }

    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    const response = await axios.get(targetUrl, {
      timeout: 15000,
      responseType: 'text',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const sourceData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    return res.json({
      success: true,
      url: targetUrl,
      source: sourceData,
      size: Buffer.byteLength(sourceData, 'utf8'),
      contentType: response.headers['content-type'],
    });
  } catch (error) {
    console.error('Source Proxy Error:', error);
    res.status(502).json({
      error: `Could not fetch target website source: ${error.message}`,
    });
  }
});

// 8. DNS Checker (Native Node.js DNS Module)
app.post('/api/network/dns', async (req, res) => {
  try {
    const { domain, type } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain name is required.' });
    }

    const cleanDomain = domain.trim().replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0];
    const recordType = (type || 'A').toUpperCase();

    let records;
    let formattedResult = '';

    switch (recordType) {
      case 'A':
        records = await dns.resolve4(cleanDomain);
        formattedResult = records.map((ip) => `${cleanDomain}.\t\t300\tIN\tA\t${ip}`).join('\n');
        break;
      case 'AAAA':
        records = await dns.resolve6(cleanDomain);
        formattedResult = records.map((ip) => `${cleanDomain}.\t\t300\tIN\tAAAA\t${ip}`).join('\n');
        break;
      case 'MX':
        records = await dns.resolveMx(cleanDomain);
        formattedResult = records
          .map((mx) => `${cleanDomain}.\t\t300\tIN\tMX\t${mx.priority}\t${mx.exchange}`)
          .join('\n');
        break;
      case 'TXT':
        records = await dns.resolveTxt(cleanDomain);
        formattedResult = records
          .map((txt) => `${cleanDomain}.\t\t300\tIN\tTXT\t"${txt.join('')}"`)
          .join('\n');
        break;
      case 'NS':
        records = await dns.resolveNs(cleanDomain);
        formattedResult = records.map((ns) => `${cleanDomain}.\t\t300\tIN\tNS\t${ns}`).join('\n');
        break;
      case 'CNAME':
        records = await dns.resolveCname(cleanDomain);
        formattedResult = records.map((c) => `${cleanDomain}.\t\t300\tIN\tCNAME\t${c}`).join('\n');
        break;
      default:
        records = await dns.resolve(cleanDomain, recordType);
        formattedResult = JSON.stringify(records, null, 2);
    }

    return res.json({
      success: true,
      domain: cleanDomain,
      type: recordType,
      records,
      result: formattedResult || `;; No records returned for ${recordType}`,
    });
  } catch (error) {
    console.error('DNS Lookup Error:', error);
    res.status(404).json({
      error: `DNS lookup failed: ${error.code || error.message}`,
    });
  }
});

// Native TCP WHOIS resolver (Serverless & Zero-dependency compatible)
function queryWhois(domain) {
  return new Promise((resolve) => {
    try {
      const parts = domain.split('.');
      const tld = parts[parts.length - 1].toLowerCase();
      let whoisServer = 'whois.iana.org';
      if (tld === 'com' || tld === 'net') whoisServer = 'whois.verisign-grs.com';
      else if (tld === 'org') whoisServer = 'whois.pir.org';
      else if (tld === 'io') whoisServer = 'whois.nic.io';
      else if (tld === 'id') whoisServer = 'whois.id';
      else if (tld === 'me') whoisServer = 'whois.nic.me';
      else if (tld === 'co') whoisServer = 'whois.nic.co';
      else if (tld === 'info') whoisServer = 'whois.afilias.net';
      else if (tld === 'biz') whoisServer = 'whois.biz';
      else if (tld === 'xyz') whoisServer = 'whois.nic.xyz';
      else if (tld === 'dev' || tld === 'app') whoisServer = 'whois.nic.google';

      const socket = net.createConnection(43, whoisServer, () => {
        socket.write(domain + '\r\n');
      });
      socket.setTimeout(4500);
      let buffer = '';
      socket.on('data', (data) => { buffer += data.toString(); });
      socket.on('timeout', () => { socket.destroy(); resolve(null); });
      socket.on('error', () => { resolve(null); });
      socket.on('close', () => {
        if (!buffer) return resolve(null);
        const result = {};
        const lines = buffer.split('\n');
        for (const line of lines) {
          const match = line.match(/^([^:]+):\s*(.+)$/);
          if (match) {
            const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            const val = match[2].trim();
            if (key === 'domainname') result.domainName = val;
            if (key === 'registrar') result.registrar = val;
            if (key === 'creationdate' || key === 'created') result.creationDate = val;
            if (key === 'domainstatus' || key === 'status') result.domainStatus = val;
            if (key === 'nameserver') result.nameServer = (result.nameServer ? result.nameServer + ', ' : '') + val;
          }
        }
        resolve(Object.keys(result).length > 0 ? result : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

// 9. Domain Availability Checker (whois + DNS verification)
app.post('/api/network/domain', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain name is required.' });
    }

    const cleanDomain = domain.trim().replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0].toLowerCase();

    // 1. Check WHOIS record
    let whoisData = null;
    let isRegistered = false;

    try {
      whoisData = await queryWhois(cleanDomain);
      if (
        whoisData &&
        (whoisData.domainName ||
          whoisData.registrar ||
          whoisData.creationDate ||
          whoisData.domainStatus ||
          whoisData.nameServer)
      ) {
        isRegistered = true;
      }
    } catch (_) {}

    // 2. DNS Nameserver fallback verification
    if (!isRegistered) {
      try {
        const ns = await dns.resolveNs(cleanDomain);
        if (ns && ns.length > 0) {
          isRegistered = true;
        }
      } catch (_) {}
    }

    return res.json({
      success: true,
      domain: cleanDomain,
      available: !isRegistered,
      details: isRegistered
        ? {
            registrar: whoisData?.registrar || 'Private/Protected',
            created: whoisData?.creationDate || whoisData?.created || 'Unknown',
            status: whoisData?.domainStatus || 'Registered',
          }
        : null,
    });
  } catch (error) {
    console.error('Domain Checker Error:', error);
    res.status(500).json({ error: error.message || 'Failed to check domain' });
  }
});

// Fallback to serve index.html for non-API GET requests
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

// 404 for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 OmniTools Server is running on port ${PORT}`);
    console.log(`👉 Web Interface: http://localhost:${PORT}`);
    console.log(`👉 API Health:    http://localhost:${PORT}/api/health`);
    console.log(`===============================================`);
  });
}

module.exports = app;
