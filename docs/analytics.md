# Site analytics

The lab’s GoatCounter site code, `schillkg`, is configured in `content/site.json`. Dashboard: [schillkg.goatcounter.com](https://schillkg.goatcounter.com/). GitHub Pages serves the site; it does not supply the visitor dashboard described here.

Recommended service: **GoatCounter**, whose hosted service is free for reasonable public usage. Its dashboard provides page views, approximate unique visits, referrers, broad geography, browsers, and click events. It does not identify the people reading a paper. See [GoatCounter](https://www.goatcounter.com/) and its [visitor-count explanation](https://www.goatcounter.com/help/sessions).

The site accepts a GoatCounter site code in `content/site.json`, described in the README. No tracking is sent while `analytics` is `null`. The dashboard remains private to logged-in users. Its “Your site” field is `www.microstructure-connectivity-lab.com`. Setup was verified with page views, explorer opening, centroid-mode selection, and the Nature paper’s PDF-link click. These initial test interactions remain in the dashboard. These events appear with readable titles in the dashboard:

| Event | What it means |
|---|---|
| `paper_download_click` | A click on a PDF link, identified by the paper slug |
| `paper_link_click` | A click on an article, full text, citation, or related paper resource |
| `resource_click` | A software, data, or teaching resource link |
| `figure_open` | A figure opened at full size from a paper page |
| `news_click` | A linked news story |
| `navigation_click` | A navigation link, with its destination page |
| `viewer_open` | A click opening the full pathway explorer |
| `viewer_mode` | A switch between streamlines and centroids |

The tracking code does not send names, emails, search text, or full external URLs. Page-view tracking is handled by the provider’s script. The script uses the official [event API](https://www.goatcounter.com/help/events). Verify the dashboard with real test visits before declaring analytics active. Avoid enabling a second automatic download/outbound tracker for the same actions, which could confuse reporting.

A PDF click is not a confirmed completed download or a reader. Publisher/repository downloads initiated elsewhere are invisible to this site. Bots, blockers, repeat visits, and privacy controls affect the counts. Aggregate analytics cannot reliably tell you who visited.

Google Analytics is an alternative if a free, more detailed dashboard is preferred. It would require a GA4 property and its measurement ID, with corresponding site configuration and privacy information. It is not installed by default.
