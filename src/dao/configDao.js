const fs = require('node:fs');
const path = require('node:path');
const appConfig = require('../../config/appConfig');

const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/healthPolicy.json'), 'utf8'));
policy.windowMinutes = appConfig.healthWindowMinutes;

/** Returns a copy of the active initial policy for API consumers. */
function getHealthRules() {
  return JSON.parse(JSON.stringify(policy));
}

module.exports = { getHealthRules, policy };
