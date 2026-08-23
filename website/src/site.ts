// The one origin this site claims as its own.
//
// Absolute by necessity: a canonical URL has to name a single origin, and
// deriving one from the incoming request is exactly what lets a second hostname
// pointed at the same deployment claim to be the original. Shared by the
// canonical link, the sitemap, and robots.txt so those three can never disagree
// about which address is real.
export const SITE_ORIGIN = 'https://bureau.smeltery.io';
