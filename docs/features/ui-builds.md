# Publishing UI builds

`bun run build:ui` builds and packages the office interface in a temporary
folder. A failed compilation, asset copy, extension package or license-copy
step leaves the served interface unchanged. Concurrent builds are refused.
The temporary folder and lock are removed when the command exits normally or
fails. After an interrupted process that could not run cleanup, confirm that no
build is running before removing `ui/.build-lock` and abandoned
`ui/.build-stage.*` folders.

Publication replaces complete files by rename and publishes HTML last. If a
replacement fails, previously replaced files are restored. JavaScript entries
have content-derived names; the previous entry remains available for a browser
that fetched the old HTML immediately before publication. Older named entries
are removed after successful publication. This is staged file publication,
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
