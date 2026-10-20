const express = require('express');
const configDao = require('../dao/configDao');
const router = express.Router();

router.get('/health-rules', (req, res) => {
  res.json({ data: configDao.getHealthRules() });
});

module.exports = router;
