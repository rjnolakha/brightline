const { z } = require('zod');

const importedLogSchema = z.object({
  sourceId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  integrationId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  timestamp: z.string().min(1).max(64),
  method: z.string().regex(/^[A-Za-z]{3,10}$/),
  endpoint: z.string().min(1).max(2048),
  statusCode: z.number().int().min(100).max(599).nullable().optional(),
  durationMs: z.number().finite().min(0).nullable().optional(),
  outcome: z.enum(['success', 'failure', 'timeout', 'network_error']).optional(),
  errorCategory: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
  errorCode: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
  correlationId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional()
});

/** Validates a normalized importer record before any database work is attempted. */
function validateImportedLog(record) {
  return importedLogSchema.safeParse(record);
}

module.exports = { validateImportedLog };
