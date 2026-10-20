const { z } = require('zod');

function validateSummary(req, res, next) {
  const parsed = z.object({
    windowMinutes: z.coerce.number().int().min(1).max(1440).optional()
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'windowMinutes must be between 1 and 1440' } });
  req.validated = parsed.data;
  next();
}

module.exports = { validateSummary };
