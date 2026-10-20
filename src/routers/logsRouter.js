const express = require('express');
const integrationsDao = require('../dao/integrationsDao');
const { validateId, validateLogsQuery } = require('../validators/integrationsValidator');
const router = express.Router({ mergeParams: true });

/** Provides bounded, sanitized log pages for a validated integration ID. */
router.get('/', validateId, validateLogsQuery, (req, res) => {
  const data = integrationsDao.getRecentLogs(req.validated.id, req.validated);
  if (!data) return res.status(404).json({ error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found' } });
  res.json({ data });
});

module.exports = router;
