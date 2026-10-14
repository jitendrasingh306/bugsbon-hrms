import readline from 'node:readline';
import { connectDb, disconnectDb } from '../config/db.js';
import { seedPermissionsAndRoles } from '../services/seed.service.js';
import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { hashPassword } from '../utils/password.js';
import { writeAudit } from '../utils/audit.js';
import { emailSchema, passwordSchema } from '../validators/common.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (hidden && rl.muted && !/^[\r\n]+$/.test(text)) rl.output.write('*');
      else rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.muted = hidden;
  });
}

try {
  await connectDb();
  await seedPermissionsAndRoles();

  const founderRole = await Role.findOne({ key: 'founder' });
  const existing = await User.countDocuments({ roles: founderRole._id });
  if (existing > 0 && !process.argv.includes('--force')) {
    console.log('A Founder account already exists. Re-run with --force to create another one.');
  } else {
    console.log('\nCreate the initial Founder / Super Admin account\n');
    const name = (await ask('Full name: ')).trim();
    if (!name) throw new Error('Name is required.');
    const email = emailSchema.parse(await ask('Email: '));
    const password = await ask('Password (min 10 chars, letters + numbers): ', { hidden: true });
    const confirm = await ask('Confirm password: ', { hidden: true });
    passwordSchema.parse(password);
    if (password !== confirm) throw new Error('Passwords do not match.');

    const user = await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      roles: [founderRole._id],
    });
    await writeAudit({
      actor: null,
      action: 'user.founder_created',
      entityType: 'User',
      entityId: user._id,
      summary: `Initial Founder account created via CLI for ${email}`,
    });
    console.log(`\nFounder account created for ${email}. You can now sign in.\n`);
  }
} catch (err) {
  const msg = err?.issues ? err.issues.map((i) => i.message).join('; ') : err.message;
  console.error(`\nFailed: ${msg}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
