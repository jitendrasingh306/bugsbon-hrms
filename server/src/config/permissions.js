// Single source of truth for every permission key in the system.
// Permissions are explicit: nothing is granted because of a job title.

export const PERMISSIONS = [
  // Employees
  { key: 'employees.view', module: 'Employees', description: 'View employees within own reporting/department scope' },
  { key: 'employees.view_all', module: 'Employees', description: 'View every employee in the company' },
  { key: 'employees.create', module: 'Employees', description: 'Create employee records and login accounts' },
  { key: 'employees.edit', module: 'Employees', description: 'Edit employee records' },
  { key: 'employees.deactivate', module: 'Employees', description: 'Deactivate and reactivate employees' },
  { key: 'employees.view_compensation', module: 'Employees', description: 'See stipend / salary information' },
  { key: 'employees.view_documents', module: 'Employees', description: 'See employee documents' },
  // Users / roles / organisation
  { key: 'users.manage', module: 'Users & Roles', description: 'Manage user accounts, role assignment, password resets' },
  { key: 'roles.manage', module: 'Users & Roles', description: 'View and edit roles and their permissions' },
  { key: 'departments.manage', module: 'Organisation', description: 'Manage departments' },
  { key: 'designations.manage', module: 'Organisation', description: 'Manage designations' },
  // Tasks
  { key: 'tasks.view_own', module: 'Tasks', description: 'View tasks assigned to me' },
  { key: 'tasks.update_own', module: 'Tasks', description: 'Update status of and submit work for my tasks' },
  { key: 'tasks.assign', module: 'Tasks', description: 'Create and assign tasks' },
  { key: 'tasks.view_team', module: 'Tasks', description: 'View tasks of employees in my scope' },
  { key: 'tasks.view_all', module: 'Tasks', description: 'View every task in the company' },
  { key: 'tasks.edit', module: 'Tasks', description: 'Edit, reschedule and reassign tasks' },
  { key: 'tasks.cancel', module: 'Tasks', description: 'Cancel tasks (reason required)' },
  { key: 'tasks.review', module: 'Tasks', description: 'Approve work or request changes' },
  { key: 'tasks.categories.manage', module: 'Tasks', description: 'Configure task categories' },
  { key: 'overview.view', module: 'Tasks', description: 'See the Daily Assignment Overview' },
  // Projects
  { key: 'projects.view', module: 'Projects', description: 'View projects I belong to' },
  { key: 'projects.manage', module: 'Projects', description: 'Create and edit projects' },
  // Builds & testing
  { key: 'builds.submit', module: 'Development & Testing', description: 'Submit builds for testing' },
  { key: 'builds.view_assigned', module: 'Development & Testing', description: 'View builds I submitted or am assigned to test' },
  { key: 'builds.view_all', module: 'Development & Testing', description: 'View every build' },
  { key: 'builds.assign_tester', module: 'Development & Testing', description: 'Assign or change testers on a build' },
  { key: 'builds.download', module: 'Development & Testing', description: 'Download APK files of builds I can access' },
  { key: 'builds.approve', module: 'Development & Testing', description: 'Give final approval to a build' },
  { key: 'tests.perform', module: 'Development & Testing', description: 'Record test results' },
  // Bugs
  { key: 'bugs.report', module: 'Bugs', description: 'Report bugs' },
  { key: 'bugs.view_assigned', module: 'Bugs', description: 'View bugs I reported or am assigned to fix' },
  { key: 'bugs.view_all', module: 'Bugs', description: 'View every bug' },
  { key: 'bugs.fix', module: 'Bugs', description: 'Work on fixes and mark bugs ready for retest' },
  { key: 'bugs.reassign', module: 'Bugs', description: 'Reassign bugs to another developer' },
  { key: 'bugs.verify', module: 'Bugs', description: 'Retest and verify fixes, reopen bugs' },
  { key: 'bugs.close', module: 'Bugs', description: 'Close verified bugs' },
  // Daily time-slot tasks & end-of-day verification
  { key: 'daily.view_own', module: 'Daily Plan', description: 'See my own time-slot schedule' },
  { key: 'daily.update_own', module: 'Daily Plan', description: 'Update status and output notes of my time-slot tasks' },
  { key: 'daily.eod_submit', module: 'Daily Plan', description: 'Submit my end-of-day summary' },
  { key: 'daily.assign', module: 'Daily Plan', description: 'Assign, edit and cancel time-slot tasks for people in my scope' },
  { key: 'daily.view_team', module: 'Daily Plan', description: 'See the daily plan of people who report to me' },
  { key: 'daily.view_all', module: 'Daily Plan', description: 'See and manage the daily plan of every user' },
  { key: 'daily.eod_review', module: 'Daily Plan', description: 'Verify or return end-of-day reports of people in my scope' },
  // Misc
  { key: 'reports.view', module: 'Reports', description: 'View reports' },
  { key: 'audit.view', module: 'Audit', description: 'View audit logs' },
  { key: 'settings.manage', module: 'Settings', description: 'Change application settings' },
];

const DAILY_STAFF = ['daily.view_own', 'daily.update_own', 'daily.eod_submit'];
const DAILY_MANAGER = ['daily.assign', 'daily.view_team', 'daily.eod_review'];
const EMPLOYEE_BASE = ['tasks.view_own', 'tasks.update_own', 'projects.view', ...DAILY_STAFF];

// Permissions added after the first release. `npm run seed` grants them once to the matching existing
// system roles (never again, so an administrator's later removal is respected).
export const ADDED_PERMISSIONS_BY_ROLE = {
  manager: [...DAILY_STAFF, ...DAILY_MANAGER],
  employee: DAILY_STAFF,
  developer: DAILY_STAFF,
  tester: DAILY_STAFF,
};

const CORE_ROLE_DEFINITIONS = [
  {
    key: 'founder',
    name: 'Founder / Super Admin',
    description: 'Complete administrative control over the HRMS.',
    isSuperAdmin: true,
    permissions: ['*'],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'Assigns and reviews work for employees within an authorised scope.',
    isSuperAdmin: false,
    permissions: [
      ...EMPLOYEE_BASE,
      'employees.view',
      'tasks.assign',
      'tasks.view_team',
      'tasks.edit',
      'tasks.cancel',
      'tasks.review',
      ...DAILY_MANAGER,
      'overview.view',
      'projects.manage',
      'builds.view_all',
      'builds.assign_tester',
      'builds.download',
      'bugs.view_all',
      'bugs.reassign',
      'bugs.verify',
      'bugs.close',
      'reports.view',
    ],
  },
  {
    key: 'employee',
    name: 'Employee / Intern',
    description: 'Works on assigned tasks and submits work.',
    isSuperAdmin: false,
    permissions: [...EMPLOYEE_BASE],
  },
  {
    key: 'developer',
    name: 'Developer',
    description: 'Employee who can submit builds for testing and fix bugs.',
    isSuperAdmin: false,
    permissions: [...EMPLOYEE_BASE, 'builds.submit', 'builds.view_assigned', 'builds.download', 'bugs.view_assigned', 'bugs.fix'],
  },
  {
    key: 'tester',
    name: 'Tester',
    description: 'Employee who tests builds, reports bugs and verifies fixes.',
    isSuperAdmin: false,
    permissions: [
      ...EMPLOYEE_BASE,
      'builds.view_assigned',
      'builds.download',
      'tests.perform',
      'bugs.report',
      'bugs.view_assigned',
      'bugs.verify',
      'bugs.close',
    ],
  },
];

const EXTRA_ROLE_DEFINITIONS = [
  {
    key: 'sales',
    name: 'Sales',
    description: 'Sales team member: follows a daily time-slot plan (calls, follow-ups) and submits an end-of-day report.',
    isSuperAdmin: false,
    permissions: [...EMPLOYEE_BASE],
  },
  {
    key: 'hr',
    name: 'HR',
    description: 'HR team member: follows a daily time-slot plan and submits an end-of-day report.',
    isSuperAdmin: false,
    permissions: [...EMPLOYEE_BASE, 'employees.view'],
  },
];

export const ROLE_DEFINITIONS = [...CORE_ROLE_DEFINITIONS, ...EXTRA_ROLE_DEFINITIONS];

export const DEFAULT_DEPARTMENTS = ['Management', 'Sales', 'Development', 'Testing', 'Design'];

export const DEFAULT_DESIGNATIONS = [
  'Founder / CEO',
  'Manager',
  'Sales Intern',
  'Developer',
  'Flutter Developer',
  'MERN Developer Intern',
  'QA Tester',
  'UI/UX Designer',
];
