const { initializeDatabase, closeDatabase, run } = require('../src/helpers/DBUtils');

const integrations = [
  ['payroll', 'Payroll', 'Payroll processing integration'],
  ['e-signature', 'E-signature', 'Electronic signature integration'],
  ['ats', 'Applicant Tracking System', 'Applicant tracking integration'],
  ['directory-sync', 'Directory Sync', 'Employee directory synchronization'],
  ['notifications', 'Notifications', 'Outbound notifications integration']
];

function seed() {
  initializeDatabase();
  const now = new Date().toISOString();
  for (const [id, name, description] of integrations) {
    run(
      `INSERT INTO integrations (id, name, category, description, critical, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description`,
      [id, name, id, description, ['payroll', 'e-signature', 'directory-sync'].includes(id) ? 1 : 0, now]
    );
    run('INSERT OR IGNORE INTO health_state (integration_id) VALUES (?)', [id]);
  }
}

if (require.main === module) {
  try {
    seed();
    console.log('Database initialized and integration definitions seeded.');
  } finally {
    closeDatabase();
  }
}

module.exports = { seed, integrations };
