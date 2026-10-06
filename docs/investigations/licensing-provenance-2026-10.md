# Licensing provenance review — 2026-10-06

## Decision and scope

The reviewed Bureau tree is `d7ab7ccb461bbe37fb92707500baa1f26046c7b3`.
This review covers its licensing history, the two October feature-gap changes,
and a broader comparison that identified earlier post-MIT upstream material.
The licensing update treats the combined distribution as a modified upstream
work subject to the applicable BSL, preserves the historical MIT grant, and
grants MIT rights only for original contributions owned by smeltery. It does
not classify the current repository as entirely MIT or independently authored.

## Pinned evidence

Upstream repository: <https://github.com/nmamano/isomux>.
Only read operations were performed against upstream.

| Evidence | Revision and finding |
| --- | --- |
| Original MIT license | `0f8b8f8eac592492be1616625689e99930c71d98`; copyright `2026 Nil`; reproduced verbatim in Bureau's NOTICE |
| Bureau's initial import | `09a6246`, dated 2026-04-22, before upstream's September license transition; the exact original source revision was not established |
| Last explicitly MIT-tagged release | `v2026.9.10`, peeled commit `1a25e230ded598a4c8e9ef74690e0a4791544895`; the later upstream NOTICE expressly preserves MIT through this release |
| First BSL license change | `b652d2626d6f2d95b7e1debc2070cd26589b0da9`, dated 2026-09-14 |
| Personal/small-organization grant and two-year conversion | `031abf160c33be1c6d570a47566b90d54d2e9fac`, dated 2026-09-14 |
| October reference snapshot | `fbfe9335f803f247969465b98a1caf29f76ef7a6`, dated 2026-10-06; untagged; its LICENSE is copied byte-for-byte into Bureau |

The inspected tags `v2026.9.14`, `v2026.9.16`, `v2026.9.17`, `v2026.9.22`,
`v2026.9.26`, and `v2026.9.28.2` all have the same LICENSE blob as the October
snapshot: `1bd873d207366881f70d267dc485ee57b5502e4a`. This verifies their license
text, not that they exhaust the source revisions used throughout Bureau's
history. No single Apache conversion date is inferred for the combined work.

Immutable primary references:

- [Historical MIT license](https://github.com/nmamano/isomux/blob/0f8b8f8eac592492be1616625689e99930c71d98/LICENSE)
- [Preserved BSL and parameters](https://github.com/nmamano/isomux/blob/fbfe9335f803f247969465b98a1caf29f76ef7a6/LICENSE)
- [Upstream historical-license notice](https://github.com/nmamano/isomux/blob/fbfe9335f803f247969465b98a1caf29f76ef7a6/NOTICE)

## Earlier material matters too

A text comparison examined Git archives of the MIT tag, the October upstream
snapshot, and the reviewed Bureau tree. It considered UTF-8 files at most
1,000,000 bytes with no NUL bytes: 2,158, 2,620, and 2,116 files respectively.
For triage, it removed blank lines, normalized whitespace and the three
`isomux`/`bureau` capitalization variants, and hashed windows of eight lines
containing at least 180 characters. It discarded windows already present
anywhere in the MIT baseline, then found newer upstream windows in 98 Bureau
files. These are candidates, **not 98 legal determinations**: common syntax,
generated schemas, third-party licenses, and MIT code introduced between the
baseline tag and the license transition can also match.

History and direct comparison confirmed that focusing only on the latest five
integrations would miss material:

| Bureau material | Evidence inspected | Treatment |
| --- | --- | --- |
| `deploy/kubernetes/seccomp/resolve.py` | Upstream introduction `e182a41617ef9b041c152712c4fc1706c4ab0d00` on 2026-09-26; Bureau addition `d32b7c95f2811dcb84d3e6881c4758cac2d7c30c`; all 81 lines match the October upstream file after replacing the project name | Concrete post-transition matching implementation; preserve BSL coverage |
| Kubernetes manifests, verification scripts, and design/hosting documentation | Matching blocks in `deploy/kubernetes/`, `deploy/kubernetes-verify/`, `docs/investigations/kubernetes-design.md`, and `docs/contributing/hosting/kubernetes.md` | Include this earlier deployment work in the distribution's upstream attribution and BSL scope |
| `server/backends/opencode/darwin-libsystem.ts` | Upstream introduction `1298fabe3f821f638654513cbc34e71204731c21` on 2026-09-27; direct comparison shows matching implementation with formatting and adaptation differences | Post-transition implementation evidence; preserve BSL coverage |
| `server/backends/opencode/authority-broker.ts` | Matching newer blocks; file itself originated upstream in August, before the transition | Mixed-age file; its creation date alone cannot classify later changes as MIT |
| Hospital skin files | Matching candidates; upstream palette introduction `b4c0b1f85cbd208378d97e8b7ad3ad4a54b80ff1` on 2026-09-12 | Example of why a match absent from the September 10 baseline is not automatically BSL |
| Seccomp profiles and generated Codex schemas | Matches include third-party license text and generated protocol types | Preserve separate component notices; similarity alone does not establish upstream ownership |

Bureau history also contains feature-gap updates throughout September 15–October
6. “Native,” renamed, or adapted implementations are not treated here as proof
of legal independence. The combined-work notice avoids an unsupported claim
that only individual newly copied files are subject to BSL.

## October integrations

Bureau `bbfa78801d64e5ad23e2694c57ef935186079ea0` adds durable pager history,
on-demand schedules, and personal room-list ordering. Bureau
`e6a4d1996dd9f302228737f13564b6cfcceb5484` adds the five larger integrations.
Both were implemented after consulting the October upstream snapshot.

| Capability | Bureau implementation | Upstream reference inspected |
| --- | --- | --- |
| Durable pager history | `server/pager/` | Upstream `47880eba7b73b4063e0d90376ce1827c74449460` retains resolved pages |
| On-demand schedules | `server/cronjobs/`, `shared/cronjobs.ts`, schedule forms | `54addcfc117ec6aa2bdb774b648a513f661f7e5f` adds on-demand scheduling |
| Signed webhooks | `server/webhooks/`, `shared/integrations/webhooks.ts`, management UI | `server/webhooks/`; ingress introduced at `d022a0e827965781bc3e0bf15aa90fcd41986b3b` |
| Room-scoped schedules | `server/cronjobs/access.ts`, schedule persistence, routes, events, and UI | `server/cronjob-visibility.ts`; room scoping at `c0576b486ba30c912ee1ade71d824a002663adee` |
| Browser tab sharing | `browser-extension/`, `server/browser-sharing/`, shared protocol, UI | `browser-extension/` and `server/browser-extension-*`; extension introduction `48e84ae90acd9d19f4a489260fe67b7378686937` |
| App thumbnails and archive | `server/apps/`, `ui/apps-view/` | `server/app-thumbnails.ts` and app lifecycle; `7ae95df2825082f086619f7284446e8d16dad2f1` |
| Personal room order and tuck/reveal | `ui/office/`, view preference routes and socket projections | `ui/office/RoomTabBar.tsx`; `db8c5e9f` and subsequent changes in the pinned snapshot |

These are subsystem maps, not exhaustive file boundaries or claims that every
line is copied. Different protocols, validation, architecture, and tests do
not by themselves establish copyright independence. The distribution retains
the upstream license rather than offering these integrations as BSL-free.

## Distribution changes and remaining limits

- Preserve the BSL text and parameters verbatim in root LICENSE.
- Keep the original MIT notice in NOTICE and credit the original project,
  creator, upstream copyright holder, and Bureau modifications separately.
- License only smeltery-owned original contributions under the separate MIT
  grant, without offering it as an alternative for the entire derivative work.
- Replace the abbreviated PolyForm claim and the site's open-source claims
  with a consistent explanation of the combined project's terms.
- Include project notices in the extension and UI/server/demo/website outputs;
  the Render image's repository copy includes them as well.

This review is bounded evidence for the chosen distribution posture, not a
complete ownership or dependency audit. It does not prove every file's exact
origin, establish all release/conversion dates, certify earlier distributions,
or resolve possible historical license violations. Git author names are not
proof of copyright ownership. Preserve separate dependency/generated-code
notices and obtain legal review for unresolved ownership or historical issues
and any future commercial licensing plan.
