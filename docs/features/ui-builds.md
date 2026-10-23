# Publishing UI builds

`bun run build:ui` builds and packages the office interface in a temporary
folder. A failed compilation, asset copy, extension package or license-copy
step leaves the served interface unchanged. Concurrent builds are refused.
The temporary folder and lock are removed when the command exits normally or
fails. After an interrupted process that could not run cleanup, confirm that no
build is running before removing `ui/.build-lock` and abandoned
`ui/.build-stage.*` folders.

Publication replaces complete files by rename and publishes HTML last. If a
replacement fails, previously replaced files are restored. JavaScript entries and deferred chunks
have content-derived names. The current and previous build’s JavaScript files
and compressed representations remain available for open tabs. Older named
assets are removed after successful publication. This is staged file publication,
not a transaction across every asset request. Run the production build command
rather than invoking the bundler directly against the served directory.

An open office checks the served UI identity once a minute while visible, and
when it regains focus, network access or visibility. If a different build is
available, it offers **Reload** or **Later**. It never reloads automatically.
Later dismisses that particular build for the current tab. A byte-identical
rebuild does not prompt again. This notice is separate from the new-release
notification: it concerns the interface already served by this office.

The identity endpoint requires a browser session and returns no cached data.
Unbuilt pages and older builds without identity metadata do not show a notice.
The standalone demo continues to use its own build workflow.

## Loading and caching

Tasks, Schedules, Apps, Skills, Plugins, Team chat and User Settings load their
view code when opened. A loading state appears while the view downloads. If it
cannot load, a visible error offers a manual reload; existing work is never
silently reloaded.

Builds include Brotli and gzip representations for text assets. The server
negotiates the encoding, sends the original content type, and varies responses
by `Accept-Encoding`. Content-named JavaScript can be cached privately for a
year; HTML and stable asset names require revalidation. Conditional requests
can return 304 without resending the body. These policies apply only to build
files after the usual route access checks, not to API responses or user files.
The public install-asset allowlist remains unchanged, and the service worker
does not cache the office shell.
