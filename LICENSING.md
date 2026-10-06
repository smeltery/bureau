# Licensing Bureau

Bureau is an independently maintained, modified distribution based on
[Isomux](https://github.com/nmamano/isomux), created by Nil Mamano. It includes
MIT-era material, later upstream material, and Bureau modifications. It is
source-available; the current combined project is not offered as an
unrestricted MIT-licensed or OSI open-source project.

## Which terms apply?

| Material | Applicable terms |
| --- | --- |
| Upstream Licensed Work, modifications, and derivative works | [Business Source License 1.1](LICENSE), with the upstream parameters preserved verbatim |
| Material inherited under the historical MIT grant | The original copyright and full MIT text in [NOTICE](NOTICE) |
| Original contributions whose copyright is owned by smeltery | [MIT](LICENSES/smeltery-MIT.txt), covering only those contribution rights |
| Other third-party material and dependencies | Their respective licenses and notices; see, for example, [the bundled seccomp license](deploy/container/seccomp/LICENSE) |

These are **not alternative licenses for the entire repository**. The MIT grant
for smeltery's contributions does not remove BSL obligations for the combined
derivative work. The BSL does not revoke the separate MIT grant for material
already obtained under MIT. This licensing update replaces Bureau's previous
abbreviated text labeled “PolyForm Shield”; it does not claim ownership of
third-party contributions or change their terms.

## Use and redistribution

The upstream BSL permits copying, modification, redistribution, and
non-production use. Its Additional Use Grant permits production use for your
own personal purposes or for an organization with at most 10 people. Other
production use, including internal use by a larger organization, requires a
commercial license from Isomux LLC. Not selling the software does not by itself
remove that condition. See [the binding license text](LICENSE); commercial
licensing inquiries go to the licensor at llc@isomux.com.

When redistributing this modified project, retain LICENSE, NOTICE,
LICENSING.md, LICENSES/, and applicable third-party notices. Conspicuously
present the license and preserve attribution in source archives and compiled
or packaged distributions. The extension ZIP and UI, server, demo, and website build outputs include
the project licensing documents. Container builds retain the repository's
notices. Dependencies retain their own obligations; these project notices do
not replace dependency licenses.

This is not an official upstream release, and no endorsement or trademark
permission is implied. Bureau cannot sell or grant an exception to someone
else's license.

## Versions and conversion

Upstream identifies releases through `v2026.9.10` as MIT-licensed. The BSL
snapshot preserved here comes from upstream commit
`fbfe9335f803f247969465b98a1caf29f76ef7a6` (2026-10-06). Earlier post-MIT
additions are also present; this commit is a review reference, not a claim
that every file originated in one release.

The BSL's Change Date is two years after the applicable upstream version was
first publicly released, and its Change License is Apache License 2.0. Dates
apply separately to each upstream version. Do not substitute a Bureau release
date or assume the entire repository converts on one date. This review does
not establish a release date for every incorporated revision, including
untagged material, and does not claim that any BSL material has converted yet.

## Provenance and review limits

The [2026-10 provenance review](docs/investigations/licensing-provenance-2026-10.md)
records the inspected commits, concrete matches, recent integration scope, and
comparison method. The distribution retains BSL coverage for the combined
modified work rather than claiming that renamed or adapted implementations
are independent of upstream.

That review is not a file-by-file legal opinion, a complete dependency audit,
or a determination about earlier distributions. Questions about uncertain
ownership, derivative-work boundaries, historical compliance, or a future
commercial release should be resolved with the relevant rights holder or
qualified legal counsel.
