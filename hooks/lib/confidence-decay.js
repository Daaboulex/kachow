// Memory confidence decay — Ebbinghaus-inspired linear decay model.
// Usage: const { decayConfidence, boostConfidence } = require('./lib/confidence-decay.js');

const DECAY_RATE = 0.005;   // per hour of elapsed time
const BOOST_AMOUNT = 0.03;  // per access
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 1.0;

function decayConfidence(confidence, lastAccessedISO) {
  if (!confidence || !lastAccessedISO) return confidence || MAX_CONFIDENCE;
  const elapsedHours = (Date.now() - new Date(lastAccessedISO).getTime()) / 3600000;
  if (elapsedHours <= 0) return confidence;
  return Math.max(MIN_CONFIDENCE, confidence - DECAY_RATE * elapsedHours);
}

function boostConfidence(confidence) {
  return Math.min(MAX_CONFIDENCE, (confidence || MIN_CONFIDENCE) + BOOST_AMOUNT);
}

module.exports = { decayConfidence, boostConfidence, DECAY_RATE, BOOST_AMOUNT, MIN_CONFIDENCE, MAX_CONFIDENCE };
