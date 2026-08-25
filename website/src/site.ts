// The one origin this site claims as its own.
//
// Absolute by necessity: a canonical URL has to name a single origin, and
// deriving one from the incoming request is exactly what lets a second hostname
// pointed at the same deployment claim to be the original. Shared by the
// canonical link, the sitemap, and robots.txt so those three can never disagree
// about which address is real.
export const SITE_ORIGIN = 'https://bureau.smeltery.io';
export const SITE_TITLE = 'bureau — Your agent office for Claude Code';
export const SITE_DESCRIPTION =
  'Friction going from 1 Claude Code to 4+? Bureau is your local-first agent office for orchestrating, monitoring, and collaborating with multiple agents.';
export const SITE_GITHUB_URL = 'https://github.com/dotbrains/bureau';
