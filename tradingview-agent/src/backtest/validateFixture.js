'use strict';

/**
 * validateFixture — strict input validation for backtest candle fixtures.
 *
 * Fails fast with a descriptive FixtureValidationError when the fixture data
 * does not meet the requirements of the analysis pipeline.
 *
 * Checks performed (in order):
 *   1. Top-level: must be a non-empty array
 *   2. Min candle count (configurable via minCandles parameter)
 *   3. Per-candle: all required fields present
 *   4. Per-candle: OHLCV values are finite numbers
 *   5. Per-candle: OHLC consistency (high ≥ open, close; low ≤ open, close; high ≥ low)
 *   6. Per-candle: volume is non-negative
 *   7. Timestamps are strictly increasing (no duplicates, no backward jumps)
 *
 * @param {Array}  candles           — Raw parsed fixture data
 * @param {object} [opts]
 * @param {number} [opts.minCandles] — Minimum required candle count (default: 50)
 * @throws {FixtureValidationError}  — On any validation failure
 */

const REQUIRED_FIELDS = ['time', 'open', 'high', 'low', 'close', 'volume'];

class FixtureValidationError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name  = 'FixtureValidationError';
    this.code  = 'INVALID_FIXTURE';
    Object.assign(this, context);
  }
}

function validateFixture(candles, { minCandles = 50 } = {}) {
  // 1. Must be a non-empty array
  if (!Array.isArray(candles)) {
    throw new FixtureValidationError(
      `Fixture must be a JSON array, got ${typeof candles}`
    );
  }

  if (candles.length === 0) {
    throw new FixtureValidationError('Fixture array is empty');
  }

  // 2. Minimum candle count
  if (candles.length < minCandles) {
    throw new FixtureValidationError(
      `Fixture has ${candles.length} candles but at least ${minCandles} are required`,
      { actual: candles.length, required: minCandles }
    );
  }

  let prevTime = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // 3. Required fields present
    for (const field of REQUIRED_FIELDS) {
      if (!(field in c)) {
        throw new FixtureValidationError(
          `Candle at index ${i} is missing required field "${field}"`,
          { index: i, field }
        );
      }
    }

    const { time, open, high, low, close, volume } = c;

    // 4. All OHLCV values must be finite numbers
    for (const [field, value] of [['open', open], ['high', high], ['low', low], ['close', close], ['volume', volume]]) {
      if (typeof value !== 'number' || !isFinite(value)) {
        throw new FixtureValidationError(
          `Candle at index ${i}: "${field}" must be a finite number, got ${value}`,
          { index: i, field, value }
        );
      }
    }

    if (typeof time !== 'number' || !isFinite(time) || time <= 0) {
      throw new FixtureValidationError(
        `Candle at index ${i}: "time" must be a positive finite number (Unix seconds), got ${time}`,
        { index: i, field: 'time', value: time }
      );
    }

    // 5. OHLC consistency
    if (high < open) {
      throw new FixtureValidationError(
        `Candle at index ${i}: high (${high}) < open (${open})`,
        { index: i, high, open }
      );
    }
    if (high < close) {
      throw new FixtureValidationError(
        `Candle at index ${i}: high (${high}) < close (${close})`,
        { index: i, high, close }
      );
    }
    if (low > open) {
      throw new FixtureValidationError(
        `Candle at index ${i}: low (${low}) > open (${open})`,
        { index: i, low, open }
      );
    }
    if (low > close) {
      throw new FixtureValidationError(
        `Candle at index ${i}: low (${low}) > close (${close})`,
        { index: i, low, close }
      );
    }
    if (high < low) {
      throw new FixtureValidationError(
        `Candle at index ${i}: high (${high}) < low (${low})`,
        { index: i, high, low }
      );
    }

    // 6. Volume must be non-negative
    if (volume < 0) {
      throw new FixtureValidationError(
        `Candle at index ${i}: volume (${volume}) must be >= 0`,
        { index: i, volume }
      );
    }

    // 7. Timestamps must be strictly increasing
    if (prevTime !== null && time <= prevTime) {
      throw new FixtureValidationError(
        `Candle at index ${i}: timestamp ${time} is not strictly greater than previous ${prevTime}`,
        { index: i, time, prevTime }
      );
    }

    prevTime = time;
  }
}

module.exports = { validateFixture, FixtureValidationError };
