# Publication review — 2026-10-06

## Result

No actual credentials were identified in the reviewed Git content, commit
messages, or exported repository discussions. Scanner findings were inspected
and classified as synthetic test data or incomplete documentation examples.
No credential rotation or history rewrite was indicated by these findings.

This is a bounded publication review, not a guarantee that no sensitive data
exists. Repository visibility was left private. Licensing is documented
separately in [LICENSING.md](../../LICENSING.md).

## Scope and method

- Baseline: Bureau `3c8ae83e90bb91e3506b14c2798293d679220d0b`.
- A fresh mirror included advertised repository refs and all 136 pull-request
  head refs, including closed PRs: 1,022 reachable commits in total.
- Gitleaks 8.30.1 scanned all mirrored history with
  `--log-opts='--all --full-history -m'` (including merge diffs), default rules, full redaction, and
  `--ignore-gitleaks-allow`. A separate directory scan examined the checked-out
  default branch, with archive traversal enabled to depth three. Gitleaks
  reported 1,019 commits with scanned diff content from the 1,022-commit mirror.
- An additional pass inspected 6,357 historical UTF-8 text blobs for home
  paths, tailnet names, and email addresses, and searched historical filenames
  for credential files, private keys, environment files, and data dumps.
- The metadata scan covered 136 issue/PR records, 110 issue comments, all PR
  reviews, and Git commit messages. There were no inline review comments.
- GitHub reported no releases or retained Actions artifacts, and the wiki and
  discussions features were disabled at review time.
- Thirteen historical image blobs were inventoried: icons, marketing artwork,
  and demo imagery. Static previews and the first/middle/last frames of each
  historical GIF were visually inspected. The visible screens contain demo
  characters and artwork, not private conversations or credentials. This was
  sampled visual inspection, not exhaustive OCR of every animation frame.

Scan exports and raw repository metadata were kept in a restricted local
temporary directory and were not added to Git. No candidate credential was
submitted to an external service to test whether it works.

## Findings and disposition

| Finding | Result |
| --- | --- |
| Eight history-scanner alerts | Four occurrences of repeated synthetic password data in redaction tests, two uses of the standard WebSocket example nonce, and two abbreviated documentation bearer tokens; none identified as a real credential |
| Six default-branch alerts | The same fixture/example categories, with historical duplicates counted only once in the current tree |
| Metadata and commit-message scan | No findings |
| Sensitive filenames | No tracked environment/credential/private-key files or database/archive/backup dumps matched the reviewed filename patterns, including historical paths |
| Tailnet hostname in regression fixtures | The original regression hostname also occurs in the already-public reference snapshot; replace current examples with an explicitly synthetic hostname, preserving the same tests and behavior |
| Contributor identities and home paths | Git history retains author/committer names and email addresses; example home paths also remain. These become visible with the history and were not treated as credentials |
| Embedded image metadata | No EXIF GPS field was found in the inventoried images; historical screenshot metadata is separate from the sampled visual review |

The fixture cleanup does not erase the previous hostname from old commits or
PR diffs. This review does not claim otherwise, and does not rewrite history.
Existing attribution and copyright notices remain intact.

## Validation and limits

The hostname substitution changes test inputs, matching expected outputs, and
comments only. The focused domain, URL-reconciliation, and app-link suites
pass without changing application behavior. The normal pre-push application
gate is required before landing the review and fixture update.

The review excludes untracked local files (including the existing
`website/.next/` directory), local application state, external services,
unreachable Git objects, and retained Actions job logs. No Actions artifacts
or release assets existed to inspect. Pattern-based scanning can miss unknown
formats, encrypted data, or credentials that resemble ordinary text. The
privacy pass is not a comprehensive personal-data classifier.

Making the repository public exposes its reachable history and repository
conversations, not just the latest tree. Future commits and comments need the
same care; this report records the inspected snapshot rather than granting
ongoing clearance.
