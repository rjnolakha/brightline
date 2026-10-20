const { z } = require('zod');

const idSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);

function validateId(req, res, next) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid integration ID' } });
  req.validated = { ...(req.validated || {}), id: parsed.data };
  next();
}

function validateLogsQuery(req, res, next) {
  const parsed = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0)
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'limit must be 1-200 and offset must be non-negative' } });
  req.validated = { ...(req.validated || {}), ...parsed.data };
  next();
}

module.exports = { validateId, validateLogsQuery };
