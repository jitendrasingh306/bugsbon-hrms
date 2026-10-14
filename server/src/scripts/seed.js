import { connectDb, disconnectDb } from '../config/db.js';
import { seedPermissionsAndRoles, seedOrganization } from '../services/seed.service.js';

const syncRoles = process.argv.includes('--sync-roles');

try {
  await connectDb();
  await seedPermissionsAndRoles({ syncRoles });
  await seedOrganization();
  console.log(
    `Seed complete: permissions, roles${syncRoles ? ' (reset to defaults)' : ''}, departments and designations are in place.`
  );
} catch (err) {
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
