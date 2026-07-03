/*
  Shared Utilities: WordGlance Extension
  Common utility functions and configuration used across all scripts
*/

// Shared configuration
const CONFIG = {
  tooltipZIndex: 999999,
  maxDefinitions: 9,
  maxTranslations: 8,
  definitionsPerPage: 3,
  translationsPerPage: 4,
  maxSynonyms: 6,
  maxAntonyms: 6,
  cacheSize: 500,
  apiTimeout: 100000,
  debounceDelay: 100,
  cacheSaveDelay: 2000 // Debounce cache saving
};

// Storage utilities with proper boolean handling
const StorageUtils = {
  async get(keys) {
    try {
      const result = await browser.storage.local.get(keys);
      return result;
    } catch (e) {
      console.warn('Storage get error:', e);
      return {};
    }
  },

  async set(items) {
    try {
      await browser.storage.local.set(items);
      return true;
    } catch (e) {
      console.warn('Storage set error:', e);
      return false;
    }
  },

  // Returns the stored value if the key is present, otherwise the default.
  // Using hasOwnProperty (not ||) ensures explicit false/0 values aren't lost.
  getValue(stored, key, defaultValue) {
    return stored.hasOwnProperty(key) ? stored[key] : defaultValue;
  }
};

// Text sanitization utility
const TextUtils = {
  sanitize(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Basic trimming and filtering
    const cleaned = text.trim().replace(/[\x00-\x1F\x7F-\x9F<>'"&]/g, '');
    
    // Length validation
    if (cleaned.length === 0 || cleaned.length > 100) return '';
    
    // Word count validation
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length > 5) return '';
    
    // Numeric-only check
    if (/^\d+$/.test(cleaned)) return '';
    
    // Valid character check (supports multiple scripts)
    const validChars = /^[\w\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u200c\u200d\s\-\'\.\,\;\:\!\?]+$/;
    if (!validChars.test(cleaned)) return '';
    
    // Must contain at least one letter
    const hasLetter = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
    if (!hasLetter.test(cleaned)) return '';
    
    return cleaned;
  }
};

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// LRU cache management
class LRUCache {
  constructor(maxSize = CONFIG.cacheSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Remove if exists (to reorder)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    
    // Add to end
    this.cache.set(key, value);
    
    // Remove oldest if over limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  has(key) {
    return this.cache.has(key);
  }

  clear() {
    this.cache.clear();
  }

  toObject() {
    return Object.fromEntries(this.cache);
  }

  fromObject(obj) {
    Object.entries(obj).forEach(([k, v]) => this.set(k, v));
  }

  get size() {
    return this.cache.size;
  }
}

// Fetch with timeout utility
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.apiTimeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// Message sending utility with error handling
async function sendMessage(message) {
  try {
    const response = await browser.runtime.sendMessage(message);
    return response;
  } catch (error) {
    console.warn('Message send error:', error);
    return { success: false, error: error.message };
  }
}

