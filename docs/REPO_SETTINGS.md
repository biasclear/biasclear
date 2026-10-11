# Repository settings

GitHub keeps a few things outside the code: the description, the website link, the topics, the social preview image and the Pages source. A pull request can't set them, so the owner enters them by hand. This file holds the exact text and image to use. `tests/test_readme.py` checks that the description and topics below fit GitHub's limits.

## 1. Pages (before merging the site)

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

The README's "Try it" link points at the site that `.github/workflows/pages.yml` deploys. Set this first, so the site goes live when the change is merged and the link works from the start.

**Settings → Environments → github-pages → Deployment branches and tags → Selected branches and tags → add `main`.**

The workflow deploys only from `main` already; this makes GitHub refuse a deploy from any other branch too, so an agent or a workflow started by hand cannot publish unreviewed pages.

## 1b. Security reports

**Settings → Code security → Private vulnerability reporting → Enable.** `SECURITY.md` tells people to use it.

## 2. About

On the repository's main page, click the gear icon next to **About**.

**Description** (114 characters):

```text
A free persuasion checker. It marks the moves a text makes on its reader and names each one. Runs in your browser.
```

**Website:**

```text
https://biasclear.com/
```

The site moved from the preview address `https://biasclear.github.io/biasclear/` to biasclear.com on 2026-10-06; GitHub redirects the old address. Ticking **Use your GitHub Pages website** fills in the same address.

**Topics** (9):

```text
persuasion
rhetoric
media-literacy
critical-thinking
text-analysis
linter
python
typescript
privacy
```

**Include in the home page:** untick **Releases** and **Packages** until the first release, so the page doesn't show empty sections. Leave **Deployments** ticked: it shows that the site is live.

## 3. Social preview

**Settings → General → Social preview → Edit → Upload an image**, and choose [`docs/img/social-preview.png`](img/social-preview.png) (1280 × 640 pixels, under 1 MB). X, Slack and other sites show this image when someone shares a link to the repository.

![The social preview: the BiasClear wordmark with a Preview label, the line "See how a text is built to move you.", and a loupe over the sample sentence "Everyone knows it is the best one yet. Only a fool would wait.", with "Everyone knows" outlined and named Consensus as proof, Tier I, and "Only a fool" named Shame lever, Tier II.](img/social-preview.png)

## How the images are made

The README's screenshots (`docs/img/hero.png`, `docs/img/hero-dark.png`) and the social preview are made from the built site by a script, so they show what the site really does:

```bash
node scripts/build-site.mjs
node scripts/readme-images.mjs
```

`scripts/readme-images.mjs` needs Playwright and its Chromium; its header says how to install them without adding them to this repository. It checks the social preview's sample sentence with the engine first and stops if the rules no longer mark it as shown. Run it again, and upload the new social preview, when a move's name or the design changes.

## 4. Before posting a link

Before posting a link to the repository or the site, run `python scripts/check_public_links.py`: it checks every address the README, the docs and the site link to, and names any that do not answer yet. Changes to the old repository's About box are an owner step (the owner's private checklist).
