const REPO = 'https://github.com/smeltery/bureau';
const BLOB = `${REPO}/blob/master`;

export const SITE = {
  origin: 'https://bureau.smeltery.io',
  github: REPO,
  quickStart: `${REPO}#quick-start`,
  docs: `${BLOB}/docs/README.md`,
  article: `${BLOB}/articles/punching-in-building-an-office-for-ai-agents.md`,
  hosting: `${BLOB}/docs/contributing/hosting-options.md`,
  access: `${BLOB}/docs/features/access-and-invites.md`,
  security: `${BLOB}/docs/security-audit.md`,
  contributing: `${BLOB}/docs/contributing/development.md`,
  issues: `${REPO}/issues`,
  license: `${BLOB}/LICENSE`,
  smeltery: 'https://github.com/smeltery',
} as const;
