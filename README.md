# Microstructure & Connectivity Lab

A static lab website built for GitHub Pages. The review version includes 64 selected first- or last-author works (60 published works and 4 preprints), individual paper summaries and illustrations, scholarly metadata, grouped software and data links, four news stories, and an interactive streamline viewer. The site is published at https://www.microstructure-connectivity-lab.com/ through GitHub Pages; the original Google Site is preserved.

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

Publication `type` can be `Article`, `Review`, `Consensus`, `Book chapter`, `Commentary`, `Conference paper`, or `Preprint`. Mark preprints explicitly; replace the existing record when a journal version appears to avoid duplicates. Use verified `datePublished` values when known; a year is sufficient otherwise. Complete author names belong in `authorList` in publication order. Never infer a missing publication date.

Optional fields include `pdf`, `publisher`, `code`, `dataset`, `resources`, `image`, `imageAlt`, `caption`, `description`, `findings`, `limitations`, `licenseUrl`, and `correction`. Existing records are examples. Do not include private local file paths in public records.

## PDFs and new uploads

Keep the Literature Drive folder as the private intake/archive. Add only public links or versions approved for public redistribution. The preview uses public publisher/repository PDF links. Earlier Drive links are held locally for a separate sharing review; they are not included in this public repository. The private archive has not been bulk-copied or made public.

For a local public PDF, save it under `public/papers/my-paper.pdf` and set `pdf` to `/papers/my-paper.pdf`. It then receives the proper GitHub Pages prefix automatically. Publisher, institutional-repository, or Zenodo PDF URLs also work. DOI links stay available even without an open PDF.

The proposed next step is Drive upload → DOI/hash matching → metadata and summary draft → editorial review → publish. This avoids publishing duplicate versions or restricted publisher PDFs. **Drive synchronization is not running yet.** See [the intake plan](docs/drive-intake-plan.md).

## Search engines, Scholar, and language models

Every paper has visible HTML text, full author citation metadata, a DOI, ScholarlyArticle/Chapter JSON-LD, a plain Markdown summary, and a BibTeX citation. The site exports `publications.json`, `sitemap.xml`, and an optional `llms.txt` index. No JavaScript is needed to read the paper text. Summaries identify findings and methods and link to authoritative source material; they do not reproduce the complete article.

The main site is enabled for indexing (`indexing: true`, `reviewPreview: false`). All three style alternatives and their comparison page remain public for feedback, with `noindex,nofollow`, no analytics, and no sitemap entries. A `noindex` directive is not access control: these review pages can be shared.

These measures make the research easier to parse; they do not guarantee indexing, citation, or prominence in an AI answer. Google states that no special AI markup or new AI text file is required: [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features). Scholar inclusion is also subject to its own rules: [Scholar inclusion guidelines](https://scholar.google.com/intl/en/scholar/inclusion.html).

## Free site analytics

GoatCounter is configured for the lab’s `schillkg` account in `content/site.json`. It is the free service for visits, page views, approximate unique visits, referring sites, and paper/resource click counts. Its hosted service is free for reasonable public usage; no paid plan is required for a normal lab site. See [GoatCounter](https://www.goatcounter.com/).

The current configuration is:

```json
"analytics": {"provider": "goatcounter", "siteCode": "schillkg"}
```

The generator installs its official script. Page views and human-readable event titles appear in the dashboard. PDF links, article links, resource links, figures, news, navigation, and viewer-mode controls have tracking hooks. The dashboard is at [schillkg.goatcounter.com](https://schillkg.goatcounter.com/). No event is sent without a configured provider. Page views, explorer controls, and a PDF-link click have been verified in the dashboard. Do not add a second generic click tracker for the same actions.

PDF-link clicks are not confirmed completed downloads or readers. Direct publisher/repository downloads bypassing this site are not counted, and blockers can undercount. Unique visitors are estimates; the dashboard does not identify individuals. See [the analytics guide](docs/analytics.md).

## GitHub Pages

Use the public project repository `schillkg/microstructure-connectivity-lab`. In Settings → Pages, select **GitHub Actions**. The supplied workflow tests a repository prefix, builds the production site with the actual Pages origin/base path, verifies links and assets, and deploys on pushes to `main`. Pull requests run checks without deploying or receiving a preview URL.

To test the repository address locally:

```bash
BASE_PATH=/microstructure-connectivity-lab PORT=4322 npm run dev
```

Visit http://127.0.0.1:4322/microstructure-connectivity-lab/. Both local servers use `dist/`, so do not run builds with different prefixes simultaneously.

The configured custom domain is `www.microstructure-connectivity-lab.com`. Ownership is verified under the GitHub account. Squarespace manages DNS, with `www` pointing to `schillkg.github.io`. Preserve the existing Google Site and Google verification TXT. See [the domain plan](docs/decision-and-migration.md). GitHub supplies the deployment path automatically; rebuild after changing domain or HTTPS settings so canonical URLs and sitemap entries match production.

## Style previews

`/designs/` compares Journal, Atlas, and Gallery treatments of the same resources page. These are separate review pages; the main site retains its current design. They are excluded from the sitemap and analytics.

## Source files

| Content | File |
|---|---|
| Publication records | `content/publications/*.json` |
| Research areas | `content/research.json` |
| People | `content/team.json` |
| Software, datasets, lectures | `content/resources.json` |
| News stories | `content/news.json` |
| Contact, indexing, analytics | `content/site.json` |
| Styling | `public/style.css` |
| Shared layout and page generation | `scripts/build.mjs` |
| Interactive pathway viewer | `public/viewer.js` |

`dist/` is generated output. Edit the source, not this folder. The homepage includes a rotatable glass-brain viewer, with an expanded explorer at `/tractography/`. The explorer offers five mean tract trajectories, independent pathway visibility and colors, local-orientation coloring, surface opacity, tube width, lighting, zoom, camera presets, optional rotation, and PNG export. It contains all 10,000 streamlines and all 341,877 original vertices from the five available reconstructions: left/right arcuate, left/right corticospinal, and callosal segment CC_4. These are three pathway groups, not a whole-brain connectome. Geometry is normalized together for display; only the matching brain-mask surface is smoothed and simplified. WebGL2 renders the tubes, with a static image fallback where unavailable. Matching FreeSurfer surfaces and parcellations are not yet available; the brain-mask shell must not be described as a cortical atlas. The Nature figure is attributed under CC BY 4.0. Other scientific assets retain their original rights; this repository does not impose a new license on them.

Every record has a direct article link and a representative image: 62 scientific figures and two clearly labeled previews for text-only articles. Fifty-seven records link to public PMC full text. Twenty-one PDF links come from authoritative publisher/repository pages; automated download checks can encounter bot challenges, so the full-text page is retained as an alternative. Attribution and license information are recorded in `docs/publication-figures.json`.

## Checks and editorial review

```bash
npm run build
npm run check
```

Checks cover generated HTML, local links/assets, anchors, repository prefixes, JSON-LD, publication exports, PDF citation links, accidental private paths, and complete streamline/brain geometry. Browser checks additionally cover desktop/mobile layouts, search/filter combinations, and viewer controls. Automated checks do not replace review of scientific summaries or verification of external download permissions. The supplied PDFs, old site, publisher metadata, Europe PMC, and author records informed this selection; the Google Scholar page could not be fully retrieved, so the bibliography is not claimed exhaustive.
