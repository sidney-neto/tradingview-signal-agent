'use strict';

/**
 * Confidence-bucket analysis for backtest reports.
 *
 * Buckets signals by their confidence score so operators can answer:
 *   "Do higher-confidence signals actually perform better?"
 *   "What confidence threshold should be used operationally?"
 *
 * Default bucket ranges:
 *   0.00–0.49  low confidence
 *   0.50–0.59  moderate
 *   0.60–0.69  above-moderate
 *   0.70–0.79  good
 *   0.80–1.00  high
 *
 * Bucket definitions are configurable via the `buckets` parameter.
 * Each bucket: { label: string, min: number, max: number }
 * Ranges are inclusive on both ends.
 */

const DEFAULT_BUCKETS = [
  { label: '0.00-0.49', min: 0.00, max: 0.49 },
  { label: '0.50-0.59', min: 0.50, max: 0.59 },
  { label: '0.60-0.69', min: 0.60, max: 0.69 },
  { label: '0.70-0.79', min: 0.70, max: 0.79 },
  { label: '0.80-1.00', min: 0.80, max: 1.00 },
];

/**
 * Assign a step to a bucket label. Returns null if no bucket matches.
 *
 * @param {number} confidence
 * @param {Array<{label:string,min:number,max:number}>} buckets
 * @returns {string|null}
 */
function assignBucket(confidence, buckets = DEFAULT_BUCKETS) {
  for (const bucket of buckets) {
    if (confidence >= bucket.min && confidence <= bucket.max) return bucket.label;
  }
  return null;
}

/**
 * Group eligible steps by confidence bucket and aggregate stats for each.
 *
 * @param {Array}  steps   — raw step array from runBacktest()
 * @param {Array}  [buckets] — bucket definitions (default: DEFAULT_BUCKETS)
 * @param {Function} aggregateGroup — shared aggregator from report.js
 * @returns {object} Map of label → aggregated stats
 */
function buildConfidenceBuckets(steps, buckets, aggregateGroup) {
  const defs = buckets || DEFAULT_BUCKETS;
  const eligible = steps.filter((s) => !s.skipped && s.isEligible);

  const result = {};
  for (const bucket of defs) {
    const group = eligible.filter(
      (s) => s.confidence >= bucket.min && s.confidence <= bucket.max
    );
    result[bucket.label] = aggregateGroup(group);
  }
  return result;
}

/**
 * Combine confidence-bucket maps from multiple reports.
 * Each map is { label → aggregated stats }.
 *
 * @param {Array<object>} bucketMaps — one per report
 * @param {Function} combineGroups   — shared combiner from report.js
 * @returns {object}
 */
function combineConfidenceBuckets(bucketMaps, combineGroups) {
  if (!bucketMaps || !bucketMaps.length) return {};

  const labels = Object.keys(bucketMaps[0]);
  const result = {};

  for (const label of labels) {
    const groups = bucketMaps.map((m) => m[label]).filter(Boolean);
    result[label] = combineGroups(groups);
  }
  return result;
}

module.exports = {
  DEFAULT_BUCKETS,
  assignBucket,
  buildConfidenceBuckets,
  combineConfidenceBuckets,
};
