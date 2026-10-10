/**
 * OmniTools Ultimate - API Client
 * Handles real fetch requests to the Express backend.
 */
function getApiBaseUrl() {
  const origin = window.location.origin;
  if (origin && origin.includes(':3005')) {
    return origin;
  }
  if (!origin || origin === 'null' || window.location.protocol === 'file:' || !origin.startsWith('http')) {
    return 'http://localhost:3005';
  }
  if (origin.includes(':5500') || origin.includes(':5501') || origin.includes(':3000') || origin.includes(':5173') || origin.includes(':8080')) {
    return 'http://localhost:3005';
  }
  return origin;
}

const API_BASE_URL = getApiBaseUrl();

const api = {
  /**
   * Helper method for JSON requests
   */
  async request(endpoint, options = {}) {
    let url = `${API_BASE_URL}${endpoint}`;
    const defaultHeaders = {
      'Content-Type': 'application/json',
    };

    const config = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    if (config.body instanceof FormData) {
      delete config.headers['Content-Type']; // Let browser set multipart boundary
    }

    let response;
    try {
      response = await fetch(url, config);
    } catch (err) {
      if (!url.startsWith('http://localhost:3005')) {
        console.warn(`[API] Connection to ${url} failed, retrying on http://localhost:3005...`);
        url = `http://localhost:3005${endpoint}`;
        response = await fetch(url, config);
      } else {
        throw new Error('Unable to connect to OmniTools backend server. Make sure it is running on port 3005.');
      }
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage = data?.error || data?.message || `Request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    return data;
  },

  // --- Network Endpoints ---
  async getDnsRecords(domain, type = 'A') {
    return this.request('/api/network/dns', {
      method: 'POST',
      body: { domain, type },
    });
  },

  async checkDomainAvailability(domain) {
    return this.request('/api/network/domain', {
      method: 'POST',
      body: { domain },
    });
  },

  // --- Media & Bypass Endpoints ---
  async bypassUrl(url) {
    return this.request('/api/bypass', {
      method: 'POST',
      body: { url },
    });
  },

  async getMediaDownloadInfo(url) {
    return this.request('/api/download/media', {
      method: 'POST',
      body: { url },
    });
  },

  async getSpotifyDownloadInfo(url) {
    return this.request('/api/download/spotify', {
      method: 'POST',
      body: { url },
    });
  },

  async uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);

    return this.request('/api/upload/image', {
      method: 'POST',
      body: formData,
    });
  },

  // --- AI Endpoints ---
  async generateAiRegex(prompt) {
    return this.request('/api/ai/regex', {
      method: 'POST',
      body: { prompt },
    });
  },

  async explainAiCode(code) {
    return this.request('/api/ai/explain', {
      method: 'POST',
      body: { code },
    });
  },

  // --- Proxy Endpoints ---
  async fetchSourceCode(url) {
    return this.request('/api/proxy/source', {
      method: 'POST',
      body: { url },
    });
  },

  // --- Auth Endpoints ---
  async register(username, password, confirmPassword) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: { username, password, confirmPassword },
    });
  },

  async login(username, password, rememberMe = true) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: { username, password, rememberMe },
    });
  },

  async getMe(token) {
    return this.request('/api/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async logout(token) {
    return this.request('/api/auth/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

window.api = api;

