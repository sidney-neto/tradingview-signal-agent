'use strict';

/**
 * Conservative scoring utilities for chart pattern quality assessment.
 *
 * Scores are always in [0, 1]. Components are combined with weights.
 * The goal is to rank patterns by structural quality, not to inflate confidence.
 */

const { lineAt } = require('./geometry');

/**
 * Score symmetry between two values relative to ATR.
 *
 * Returns 1.0 when identical, 0.0 when |diff| >= 2×ATR.
 *
 * @param {number} v1
 * @param {number} v2
 * @param {number} atrValue
 * @returns {number} [0, 1]
 */
function scoreSymmetry(v1, v2, atrValue) {
  if (atrValue <= 0) return v1 === v2 ? 1 : 0;
  const diff = Math.abs(v1 - v2);
  return Math.max(0, 1 - diff / (2 * atrValue));
}

/**
 * Count how many pivot points are "touching" a fitted line (within tolerance).
 *
 * A touch is when the pivot price is within `touchFraction × ATR` of the line.
 *
 * @param {Array<{index: number, price: number}>} pivots
 * @param {{ slope: number, intercept: number }} line
 * @param {number} atrValue
 * @param {number} [touchFraction=0.5]
 * @returns {number}
 */
function countTouches(pivots, line, atrValue, touchFraction = 0.5) {
  const tolerance = atrValue * touchFraction;
  let count = 0;
  for (const p of pivots) {
    const linePrice = lineAt(line, p.index);
    if (Math.abs(p.price - linePrice) <= tolerance) count++;
  }
  return count;
}

/**
 * Score how close the current price is to a breakout level.
 *
 * Returns 1.0 when price is at the level, 0.0 when distance >= 2×ATR.
 *
 * @param {number} currentPrice
 * @param {number} level
 * @param {number} atrValue
 * @returns {number} [0, 1]
 */
function scoreBreakoutProximity(currentPrice, level, atrValue) {
  if (atrValue <= 0 || level === null || level === undefined) return 0;
  const dist = Math.abs(currentPrice - level);
  return Math.max(0, 1 - dist / (2 * atrValue));
}

/**
 * Volume confirmation delta.
 *
 * Returns a small adjustment in [-0.10, +0.10] based on volume vs. average.
 * Used additively on top of a base quality score.
 *
 * @param {number} currentVolume
 * @param {number} avgVol
 * @returns {number}
 */
function volumeBonus(currentVolume, avgVol) {
  if (!avgVol || avgVol === 0) return 0;
  const ratio = currentVolume / avgVol;
  if (ratio >= 2.0) return  0.10;
  if (ratio >= 1.5) return  0.06;
  if (ratio >= 1.2) return  0.03;
  if (ratio <= 0.4) return -0.08;
  if (ratio <= 0.6) return -0.04;
  return 0;
}

/**
 * Combine component scores into a single quality score [0, 1].
 *
 * @param {Array<{score: number, weight: number}>} components
 * @returns {number} [0, 1]
 */
function weightedScore(components) {
  let total = 0, totalWeight = 0;
  for (const c of components) {
    total       += c.score * c.weight;
    totalWeight += c.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.min(1, Math.max(0, total / totalWeight));
}

/**
 * Map a quality score to a pattern confidence value.
 *
 * The confidence is intentionally capped below 0.75 — pattern detection
 * is heuristic and should not override the core signal engine.
 *
 * @param {number} quality [0, 1]
 * @returns {number} [0.25, 0.70]
 */
function qualityToConfidence(quality) {
  if (quality >= 0.85) return 0.70;
  if (quality >= 0.75) return 0.63;
  if (quality >= 0.65) return 0.56;
  if (quality >= 0.55) return 0.49;
  if (quality >= 0.45) return 0.42;
  if (quality >= 0.35) return 0.35;
  return 0.28;
}

/**
 * Score the number of trendline touches as a component.
 * 2 touches → 0.5, 3 touches → 0.8, 4+ touches → 1.0
 *
 * @param {number} n - number of touches
 * @returns {number} [0, 1]
 */
function scoreTouchCount(n) {
  if (n <= 1) return 0;
  if (n === 2) return 0.50;
  if (n === 3) return 0.80;
  return 1.00;
}

module.exports = {
  scoreSymmetry,
  countTouches,
  scoreBreakoutProximity,
  volumeBonus,
  weightedScore,
  qualityToConfidence,
  scoreTouchCount,
};
