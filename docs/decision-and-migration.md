# Maintaining the M&C Lab website with GitHub and Codex

GitHub Pages is a good fit for this lab website. Hosting on GitHub does not limit how polished the site can look: it serves the finished HTML, CSS, JavaScript, images, and PDFs. The design is controlled by the website code. GitHub provides hosting and revision history; Codex can help edit the content and design.

The current prototype uses a zero-dependency Node static generator. Each paper has one record in `content/publications/*.json`. That record supplies its title, authors, date, topics, summary, figure, and links to the homepage highlights, topic pages, searchable publication list, individual publication page, and related work. Correcting a paper once updates every place it appears the next time the site is built.

The site contains **64 selected works (60 published works and 4 preprints)**, including reviews and book chapters. Selection used the supplied paper collection and verified publisher/Crossref metadata; it is not a complete Google Scholar export. Scientific summaries, publication types, the roster, and figure choices can be revised through the same content records. Automatic Drive ingestion is still a proposed next step, not a running service.

## A practical update workflow

1. Add or update one publication JSON record and its figure or PDF link, directly or with Codex.
2. Preview the site locally and review the rendered result.
3. Commit and push the update. The GitHub Actions workflow builds the static website and deploys it to Pages when changes reach the publishing branch.

For a single editor, pushing approved changes directly is simple. A branch and pull request can optionally add a colleague's review before merging; merging then triggers the same publishing workflow. Keep the website generator and content together so revision history can restore earlier versions. GitHub supports this build-and-deploy approach with its official Pages actions. [GitHub Actions deployment documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## PDFs and figures

Keep Drive as the private archive/intake and publish selected, approved records and download destinations. See [Drive intake plan](drive-intake-plan.md). Do not copy the complete PDF archive into the website repository.


Keep existing public Google Drive PDF links initially; moving the website does not require moving the PDFs. Each publication record can point to the existing file, so repeated appearances of the paper reuse the same destination.

For files hosted with the website, place a PDF once in `public/papers/` or `public/assets/` and reference its direct `/papers/...pdf` or `/assets/...pdf` URL. Reuse one figure path wherever that paper appears. Optimize website figures rather than storing several presentation-sized copies. Large datasets belong in a research repository or other download service, with links from the site.

GitHub Pages limits the published site to 1 GB and has a soft bandwidth limit of 100 GB per month. Regular Git files must be no larger than 100 MiB; browser uploads are limited to 25 MiB. Git LFS is not supported for Pages. [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [File limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [LFS restriction](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)

## Cost and tradeoffs

GitHub Pages is included on GitHub Free when the source repository is public. A private source repository needs a paid plan that supports Pages; the published lab site is still public. Standard GitHub Actions runners are free for public repositories. The existing domain renewal remains separate. [Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

The advantages are flexible design, one publication source, portable content, automatic publishing, and a recoverable edit history. The tradeoff is that editing uses files and a build process instead of Google Sites' visual editor. This prototype avoids third-party package dependencies, but the Node runtime and deployment workflow still need occasional maintenance. Pages serves a static website; features needing a server or private database require another service. [Static hosting behavior](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## Moving the existing domain

1. Finish the content migration and test on a temporary GitHub Pages address while Google Sites continues serving the current domain. With the supplied username, an account-site repository would be `schillkg.github.io`; a project repository can also have the custom domain. Confirm the account spelling and any existing Pages site before creating the repository. [Site types](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
2. Preserve old page URLs, including `/research`, `/team`, `/resources`, `/contact`, `/publications`, and its existing nested topic/list paths. Test bookmarked URLs explicitly. Build aliases for any intentionally changed paths; static redirect pages are not server-configured HTTP 301 redirects. Keep existing Drive PDF destinations working.
3. Verify ownership in account **Settings → Pages** using GitHub's generated DNS TXT record, and retain that record. [Domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
4. Add `www.microstructure-connectivity-lab.com` in repository **Settings → Pages** before switching DNS. Then point the `www` CNAME directly to `schillkg.github.io`, without a repository path. Configure the apex with GitHub's documented A records or ALIAS/ANAME; properly configured apex and `www` redirect to the selected canonical domain. With Actions publishing, a repository `CNAME` file is ignored: the Pages setting controls the domain. [Custom-domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
5. Change the website routing records only. Preserve MX records and email-related TXT records such as SPF, DKIM, and DMARC. Keep the registrar and other DNS services in place unless there is a separate reason to change them.
6. Allow DNS and certificate provisioning to finish, enable HTTPS, and check both domain variants, legacy URLs, figures, and PDFs. Keep the Google Sites content available until those checks pass. [HTTPS setup](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)

The configured canonical domain is https://www.microstructure-connectivity-lab.com/. Ownership is verified by GitHub. Squarespace DNS points `www` to `schillkg.github.io` and the bare domain to GitHub's four A addresses (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`), with a 30-minute TTL. Retain the GitHub challenge TXT and the original Google verification TXT. The existing Google Site is preserved. The old Squarespace forwarding rule has been replaced; GitHub Pages handles the bare-domain redirect to `www`. The GitHub certificate is active and HTTPS enforcement is enabled. Both domain variants have passed strict TLS checks against GitHub. DNS resolvers may temporarily retain the previous Google Sites or Squarespace answers until their caches expire.
