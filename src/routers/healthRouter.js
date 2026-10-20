const express = require('express');
const healthDao = require('../dao/healthDao');
const { validateSummary } = require('../validators/healthValidator');
const { isReady } = require('../helpers/DBUtils');

const router = express.Router();

/** Health endpoints delegate all status and metric decisions to healthDao. */
router.get('/summary', validateSummary, (req, res) => {
  res.json({ data: healthDao.getSummary({ windowMinutes: req.validated.windowMinutes }) });
});

router.get('/live', (req, res) => res.json({ data: { status: 'LIVE', timestamp: new Date().toISOString() } }));

router.get('/ready', (req, res) => {
  const ready = isReady();
  res.status(ready ? 200 : 503).json({ data: { status: ready ? 'READY' : 'NOT_READY' } });
});

module.exports = router;
