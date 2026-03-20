'use strict';

/**
 * Generic in-memory TTL cache.
 *
 * Stores arbitrary values with a per-entry expiry timestamp.
 * Expired entries are evicted lazily on get() and optionally via an
 * interval-based sweep to prevent unbounded memory growth in long-running processes.
 *
 * Usage:
 *   const { TtlCache } = require('./ttlCache');
 *   const cache = new TtlCache({ ttlMs: 60_000 });
 *
 *   cache.set('key', value);
 *   cache.get('key');   // returns value or undefined if missing/expired
 *   cache.has('key');   // true if present and not yet expired
 *   cache.delete('key');
 *   cache.clear();
 *   cache.size;         // number of entries (including possibly expired)
 */
class TtlCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs=60000]           — default TTL for entries
   * @param {number} [opts.sweepIntervalMs=null]  — if set, run a background sweep every N ms
   */
  constructor({ ttlMs = 60_000, sweepIntervalMs = null } = {}) {
    this._defaultTtl = ttlMs;
    this._store      = new Map();   // Map<key, { value, expiresAt }>

    if (sweepIntervalMs && sweepIntervalMs > 0) {
      this._sweepTimer = setInterval(() => this._sweep(), sweepIntervalMs);
      this._sweepTimer.unref(); // do not prevent process exit
    }
  }

  /**
   * Store a value under key. Overwrites any existing entry.
   *
   * @param {string} key
   * @param {*}      value   — must not be `undefined` (indistinguishable from a cache miss)
   * @param {number} [ttlMs] — entry-specific TTL; falls back to constructor default
   */
  set(key, value, ttlMs = this._defaultTtl) {
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Retrieve a value by key. Returns `undefined` on miss or expiry.
   *
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Return true if key exists and has not yet expired.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Remove a specific entry.
   * @param {string} key
   */
  delete(key) {
    this._store.delete(key);
  }

  /**
   * Remove all entries.
   */
  clear() {
    this._store.clear();
  }

  /**
   * Number of entries in the internal store (may include some that have expired
   * but not yet been swept out by lazy eviction).
   * @type {number}
   */
  get size() {
    return this._store.size;
  }

  /** @private */
  _sweep() {
    const now = Date.now();
    for (const [key, entry] of this._store.entries()) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }
}

module.exports = { TtlCache };
