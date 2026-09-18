# Microstructure & Connectivity Lab

A static lab website built for GitHub Pages. The review version includes 53 selected first- or last-author works (50 published works and 3 preprints), individual paper summaries, scholarly metadata, software and data links, and an interactive streamline viewer. The existing Google Site and domain remain separate during review.

## Local preview

Requires Node.js 22 or later; no package installation is needed.

```bash
npm run dev
```

Open http://127.0.0.1:4321/. After editing, run `npm run build` and reload. Stop the server with Ctrl+C.

## Updating a paper

Each paper has one JSON record in `content/publications/`. Its title, authors, summary, figure, findings, and links populate the publication list, detail page, year list, topic pages, research links, downloadable citation, and machine-readable exports. The newest published papers and preprints appear on the homepage automatically. The Nature brain-chart study has a dedicated homepage feature.

Example request to Codex:

> Add this paper using its DOI, accepted manuscript, and figure. Draft the research question, methods, findings, and limitations for review. Link the code and dataset. Build and check the site, then publish the approved changes.

Publication `type` can be `Article`, `Review`, `Consensus`, `Book chapter`, `Commentary`, or `Preprint`. Mark preprints explicitly; replace the existing record when a journal version appears to avoid duplicates. Use verified `datePublished` values when known; a year is sufficient otherwise. Complete author names belong in `authorList` in publication order. Never infer a missing publication date.

Optional fields include `pdf`, `publisher`, `code`, `dataset`, `resources`, `image`, `imageAlt`, `caption`, `description`, `findings`, `limitations`, `licenseUrl`, and `correction`. Existing records are examples. Do not include private local file paths in public records.

## PDFs and new uploads

Keep the Literature Drive folder as the private intake/archive. Add only public links or versions approved for public redistribution. The preview uses public publisher/repository PDF links. Earlier Drive links are held locally for a separate sharing review; they are not included in this public repository. The private archive has not been bulk-copied or made public.

For a local public PDF, save it under `public/papers/my-paper.pdf` and set `pdf` to `/papers/my-paper.pdf`. It then receives the proper GitHub Pages prefix automatically. Publisher, institutional-repository, or Zenodo PDF URLs also work. DOI links stay available even without an open PDF.

The proposed next step is Drive upload → DOI/hash matching → metadata and summary draft → editorial review → publish. This avoids publishing duplicate versions or restricted publisher PDFs. **Drive synchronization is not running yet.** See [the intake plan](docs/drive-intake-plan.md).

## Search engines, Scholar, and language models

Every paper has visible HTML text, full author citation metadata, a DOI, ScholarlyArticle/Chapter JSON-LD, a plain Markdown summary, and a BibTeX citation. The site exports `publications.json`, `sitemap.xml`, and an optional `llms.txt` index. No JavaScript is needed to read the paper text. Summaries identify findings and methods and link to authoritative source material; they do not reproduce the complete article.

The review site uses `noindex,follow` to avoid indexing unfinished text. Set `indexing: true` and `reviewPreview: false` in `content/site.json` at the approved domain launch. Sitemap and crawlable content are generated in either mode. A `noindex` directive is not access control: the preview is public and can be shared.

These measures make the research easier to parse; they do not guarantee indexing, citation, or prominence in an AI answer. Google states that no special AI markup or new AI text file is required: [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features). Scholar inclusion is also subject to its own rules: [Scholar inclusion guidelines](https://scholar.google.com/intl/en/scholar/inclusion.html).

## PDF link analytics

Tracking is disabled (`analytics: null`). `paper_download_click` hooks are implemented with stable paper slugs for normal and middle-button link clicks. No event is sent without a configured analytics provider.

If Plausible is chosen, create the site in its dashboard and copy its current unique `https://plausible.io/js/pa-....js` URL into `content/site.json`:

```json
"analytics": {"provider": "plausible", "scriptUrl": "https://plausible.io/js/pa-YOUR_ACTUAL_SITE_ID.js"}
```

Create a matching `paper_download_click` event goal. The generator installs the standard initialization snippet. Check the live dashboard before treating tracking as active. Count this metric as **PDF link clicks**, not confirmed downloads or readers. Direct downloads bypassing this site are not counted; blockers can undercount and repeated clicks can overcount. See [Plausible custom events](https://plausible.io/docs/custom-event-goals).

## GitHub Pages

Use the public project repository `schillkg/microstructure-connectivity-lab`. In Settings → Pages, select **GitHub Actions**. The supplied workflow tests a repository prefix, builds the production site with the actual Pages origin/base path, verifies links and assets, and deploys on pushes to `main`. Pull requests run checks without deploying or receiving a preview URL.

To test the repository address locally:

```bash
BASE_PATH=/microstructure-connectivity-lab PORT=4322 npm run dev
```

Visit http://127.0.0.1:4322/microstructure-connectivity-lab/. Both local servers use `dist/`, so do not run builds with different prefixes simultaneously.

Custom-domain migration is separate; see [the domain plan](docs/decision-and-migration.md). Do not change DNS until the temporary site has been reviewed. Set the custom domain in Pages, verify ownership, update the required web DNS records, preserve mail records, and enable HTTPS. GitHub supplies the deployment path automatically.

## Source files

| Content | File |
|---|---|
| Publication records | `content/publications/*.json` |
| Research areas | `content/research.json` |
| People | `content/team.json` |
| Resources | `content/resources.json` |
| Contact, indexing, analytics | `content/site.json` |
| Styling | `public/style.css` |
| Shared layout and page generation | `scripts/build.mjs` |
| Interactive pathway viewer | `public/viewer.js` |

`dist/` is generated output. Edit the source, not this folder. The streamline demonstration contains selected arcuate, corticospinal, and callosal fibers, not a whole-brain connectome; coordinates are reduced and normalized for display. The Nature figure is attributed under CC BY 4.0. Other scientific assets retain their original rights; this repository does not impose a new license on them.

## Checks and editorial review

```bash
npm run build
npm run check
```

Checks cover generated HTML, local links/assets, anchors, repository prefixes, JSON-LD, publication exports, PDF citation links, and accidental private paths. Browser checks additionally cover desktop/mobile layouts, search/filter combinations, gallery controls, and the viewer. Automated checks do not replace review of scientific summaries or verification of external download permissions. The supplied PDFs and publisher metadata informed this selection; the Google Scholar page could not be fully retrieved.
