# Drive intake for the lab website

Use Drive as the **private intake and archive**, and keep an explicit set of approved public publication records and files. A new PDF should produce a draft for review; approval should trigger the website update.

The existing Drive archive contains multiple manuscript versions and sharing states. Treat it as private intake; select and verify public download destinations individually.

Do not bulk-copy this archive into GitHub Pages. It would consume over half the 1 GB published-site allowance before adding the website's other assets; changing binary files also enlarges Git history. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Proposed publication flow

1. **Detect a new or changed file.** Keep a private intake ledger with Drive file ID, modification/version information, normalized DOI, and a SHA-256 checksum of the downloaded file. File ID tracks updates; hash catches byte-identical copies; DOI groups versions of the same paper. Preserve distinctions between preprints, accepted manuscripts, and publisher versions. Flag uncertain matches rather than silently merging similar titles.
2. **Prepare a draft.** Extract citation metadata, propose topics and a short summary, and select a candidate figure with its source page and caption. Check metadata against the DOI record where available. A reviewer confirms the scientific interpretation, figure, and the specific PDF version approved for public redistribution.
3. **Review privately, then publish.** Review proposed metadata, summary, figure, and PDF destination before adding publish-ready changes to a pull request. A pull request in a public repository is public too, so private source PDFs and unapproved extracts belong in a private review area. Merge the approved website changes to trigger the existing build and deployment workflow.
4. **Keep the page address stable.** Use `/publications/slug/` as the permanent landing page. Its PDF target can later move between Drive, an institutional repository, Zenodo, or object storage without changing links to the paper's page.

For the initial website, retain existing **verified public Drive links**. Keep approved public PDFs separate from the private archive; sharing an entire intake folder would also affect its children through inherited permissions. Later, choose a destination for selected approved PDFs based on permanence, size, and access requirements. A DOI-only record remains useful when no public PDF is available. [Drive sharing and inheritance](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

## How automatic detection would work

Start with a scheduled importer, for example daily, plus a manual run button. For this folder size, listing the folder's contents and comparing IDs, modified times, and checksums is straightforward. Include a reconciliation pass so moved files and nested folders are handled deliberately. [Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files)

For incremental synchronization, Google's Changes API supplies a starting page token, paginated changes, and a new token to save after processing. The change feed is associated with a user or shared drive; the importer must identify changes relevant to the intake folder. [Retrieving changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)

A push webhook is an optional later improvement. It needs a separate HTTPS receiver; static GitHub Pages cannot act as that receiver. Drive notifications only announce that changes exist, so the importer must still retrieve them. `changes.watch` channels last at most one week, default to one hour if expiration is omitted, and do not renew automatically. Scheduled polling avoids this extra service and renewal work. [Google push notification requirements](https://developers.google.com/workspace/drive/api/guides/push)

## Credentials and implementation status

A GitHub importer needs its own Google authentication; the connected Drive session used for inspection does not configure a standalone background job. One option is a service account with **Viewer access explicitly granted to the intake folder**, subject to institutional sharing restrictions. It is a separate identity, not the user's private account. Another option is user OAuth with explicitly authorized access. Choose scopes for the actual intake method: `drive.file` covers app-selected files, while `drive.readonly` permits reading and downloading the files available to that identity. [Service accounts](https://developers.google.com/identity/protocols/oauth2/service-account), [Drive roles](https://developers.google.com/workspace/drive/api/guides/ref-roles), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Keep credentials in the server-side job's protected configuration, never website JavaScript, publication JSON, logs, or committed files. Google supports federated credentials for GitHub Actions to avoid a long-lived service-account key. [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)

This is a proposed workflow. DOI import, document extraction, review automation, and scheduled synchronization are **not implemented**. No monitor has been created, and no Drive files or permissions have been changed.
