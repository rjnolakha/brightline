const healthDao = require('../dao/healthDao');
const { policy } = require('../dao/configDao');
const logger = require('./logger');

/** Schedules serial health evaluations; stop() clears the timer and awaits active work. */
function createHealthScheduler({ intervalMs = policy.evaluationIntervalSeconds * 1000, evaluate = healthDao.evaluateAll } = {}) {
  let timer;
  let running = false;
  let active = Promise.resolve();

  async function tick() {
    if (running) return false;
    running = true;
    active = Promise.resolve().then(() => evaluate({ persist: true })).catch((error) => {
      logger.error({ event: 'health.evaluation.failed', errorName: error.name, errorCode: error.code });
      try {
        healthDao.recordEvaluationFailure(error);
      } catch (recordError) {
        logger.error({ event: 'health.evaluation.failure_recording_failed', errorName: recordError.name, errorCode: recordError.code });
      }
      return false;
    }).finally(() => { running = false; });
    return active;
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
      tick();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await active;
    },
    tick,
    isRunning: () => running
  };
}

module.exports = { createHealthScheduler };
