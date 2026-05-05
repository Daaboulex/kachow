// Memory confidence decay — Ebbinghaus-inspired linear decay model.
// Usage: const { decayConfidence, boostConfidence } = require('./lib/confidence-decay.js');

const DECAY_RATE = 0.005;   // per hour of elapsed time
const BOOST_AMOUNT = 0.03;  // per access
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 1.0;

function decayConfidence(confidence, lastAccessedISO) {
  if (confidence == null || confidence === '') confidence = MAX_CONFIDENCE;
  if (typeof confidence !== 'number' || isNaN(confidence)) return MAX_CONFIDENCE;
  if (!lastAccessedISO) return confidence;
  const ts = new Date(lastAccessedISO).getTime();
  if (isNaN(ts)) return confidence; // malformed date — return unchanged, don't produce NaN
  const elapsedHours = (Date.now() - ts) / 3600000;
  if (elapsedHours <= 0) return confidence;
  return Math.max(MIN_CONFIDENCE, confidence - DECAY_RATE * elapsedHours);
}

function boostConfidence(confidence) {
  if (confidence == null || typeof confidence !== 'number' || isNaN(confidence)) confidence = MIN_CONFIDENCE;
  return Math.min(MAX_CONFIDENCE, confidence + BOOST_AMOUNT);
}

module.exports = { decayConfidence, boostConfidence, DECAY_RATE, BOOST_AMOUNT, MIN_CONFIDENCE, MAX_CONFIDENCE };
