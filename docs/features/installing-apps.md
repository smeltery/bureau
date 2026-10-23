# Install the office and apps

Use **Install Bureau** in the office header or **Device Settings** to install the
office. In a browser that supplies an install prompt, the button opens that
prompt. Accepting or dismissing it remains your choice. If a prompt is unavailable,
Bureau shows instructions for the browser's install menu instead. An installed
office window hides its own install button.

On iPhone and iPad, open the page in Safari, choose **Share → Add to Home Screen**,
then confirm **Add**. The instructions include a selectable page address, useful
when opening the link from another installed app. Installation availability is
controlled by the browser; use HTTPS (or localhost for development).

## Install an individual app

Choose **Install app** on an app's card in Apps. This opens its office short link
with installation instructions. You can also use the install button in the app
page's header. Installing this page creates a separate app entry, opening the app
and its existing agent-chat view rather than the office home page.

Each app has its own manifest identity, start URL and scope at `/<name>/`. A
short link without the final slash redirects to that canonical path. The page
uses the running app's HTML title and embedded image icons when available. A
letter icon and the registered name provide fallbacks. External icon URLs are
not fetched. Android manifests additionally offer Bureau's PNG icons for browser
installability; their launcher icon may consequently use the Bureau artwork.

Metadata is read without credentials from the running app's registered local
port, with a two-second timeout, 256 KiB response limit, no redirects and a
one-minute cache keyed to the app registration. Unavailable or stopped apps use
fallback metadata. App HTML is never executed in the office metadata reader.

Bundled office icons, the office manifest and the no-op service worker can be
fetched without sign-in so browser install services can read them. App manifests
and app pages remain private.

The manifest endpoint is `GET /api/apps/:name/manifest?generation=<hostGen>`.
It requires a current browser session and access to that app. Stale registrations,
removed apps, and revoked access cannot retrieve a manifest. Installation does
not grant access: office sign-in and app permissions still apply when launching.
The service worker does not cache office data or add offline support.

Browser references: [install prompts](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)
and [credentialed manifests](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/index.html).
