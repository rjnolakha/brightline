const express = require('express');
const integrationsDao = require('../dao/integrationsDao');
const healthDao = require('../dao/healthDao');
const { validateId } = require('../validators/integrationsValidator');
const { policy } = require('../dao/configDao');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ data: integrationsDao.listIntegrations() });
});

router.get('/:id/health', validateId, (req, res) => {
  const data = integrationsDao.getIntegration(req.validated.id);
  if (!data) return res.status(404).json({ error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found' } });
  res.json({ data: { ...data, policy: { ...policy, integration: policy.integrations[data.integration.id] } } });
});

router.get('/:id/history', validateId, (req, res) => {
  const data = integrationsDao.getIntegration(req.validated.id);
  if (!data) return res.status(404).json({ error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found' } });
  res.json({ data: healthDao.getHistory(req.validated.id) });
});

module.exports = router;
