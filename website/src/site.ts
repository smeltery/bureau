const REPO = 'https://github.com/smeltery/bureau';
const BLOB = `${REPO}/blob/master`;

export const SITE = {
  origin: 'https://bureau.smeltery.io',
  github: REPO,
  quickStart: `${REPO}#quick-start`,
  docs: `${BLOB}/docs/README.md`,
  article: `${BLOB}/articles/punching-in-building-an-office-for-ai-agents.md`,
  tasks: `${BLOB}/docs/features/task-system-design.md`,
  schedules: `${BLOB}/docs/features/cronjob-system-design.md`,
  appChat: `${BLOB}/docs/features/app-chat.md`,
  localHosting: `${BLOB}/docs/contributing/hosting/local.md`,
  privateHosting: `${BLOB}/docs/contributing/hosting/private.md`,
  domainHosting: `${BLOB}/docs/contributing/hosting/domain.md`,
  hosting: `${BLOB}/docs/contributing/hosting-options.md`,
  access: `${BLOB}/docs/features/access-and-invites.md`,
  security: `${BLOB}/docs/security-audit.md`,
  contributing: `${BLOB}/docs/contributing/development.md`,
  issues: `${REPO}/issues`,
  licenseText: `${BLOB}/LICENSE`,
  notices: `${BLOB}/NOTICE`,
  license: `${BLOB}/LICENSING.md`,
  upstream: 'https://github.com/nmamano/isomux',
  smeltery: 'https://github.com/smeltery',
} as const;
