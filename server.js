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

// 5. AI Regex Generator (Official Google Gemini SDK @google/genai)
app.post('/api/ai/regex', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Regex prompt description is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error:
          'GEMINI_API_KEY is not configured in .env. Please get an API key from Google AI Studio (https://aistudio.google.com/) and add it to your .env file.',
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const promptText = `You are an expert Regular Expression engine.
The user wants a regex for: "${prompt}".

Return a valid, strict JSON object with NO surrounding markdown backticks, matching this exact schema:
{
  "regex": "/.../flags",
  "explanation": "Detailed breakdown explaining the tokens, anchors, and character classes."
}`;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API request timed out after 45s.')), 45000)
    );

    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: promptText,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      // Fast fallback to flash-lite
      response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: promptText,
      });
    }

    let rawText = response.text || '';
    // Strip possible markdown code blocks if model included them
    rawText = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(rawText);
      return res.json({
        success: true,
        regex: parsed.regex || '/.*/',
        explanation: parsed.explanation || 'Regex generated successfully.',
      });
    } catch (_) {
      return res.json({
        success: true,
        regex: rawText,
        explanation: 'Generated by Google Gemini.',
      });
    }
  } catch (error) {
    console.error('AI Regex Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate regex with Gemini' });
  }
});

// 6. AI Code Explainer (Official Google Gemini SDK @google/genai)
app.post('/api/ai/explain', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code snippet is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error:
          'GEMINI_API_KEY is not configured in .env. Please get an API key from Google AI Studio (https://aistudio.google.com/) and add it to your .env file.',
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const promptText = `You are a Senior Full-Stack Engineer and Code Reviewer.
Analyze and explain the following code snippet thoroughly:

\`\`\`
${code}
\`\`\`

Provide your response in clean, professional Markdown with:
1. **Overview**: Summary of what the code does.
2. **Key Components**: Bulleted breakdown of major variables, logic, and patterns.
3. **Complexity & Efficiency**: Time/space complexity (if applicable).
4. **Suggestions**: Potential bugs, security considerations, or refactoring improvements.`;

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API request timed out after 45s.')), 45000)
    );

    let response;
    try {
      response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: promptText,
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      // Fallback to flash-lite
      response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: promptText,
      });
    }

    return res.json({
      success: true,
      explanation: response.text,
    });
  } catch (error) {
    console.error('AI Code Explainer Error:', error);
    res.status(500).json({ error: error.message || 'Failed to explain code with Gemini' });
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
