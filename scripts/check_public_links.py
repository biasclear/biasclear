"""Check that every public address the README, the docs and the site link to is live.

Run it before the repository or the site is announced, before each release,
and after any change of address. It needs the network, so CI does not run
it. It collects every absolute ``https://`` address from README.md,
CHANGELOG.md, SECURITY.md, docs/REPO_SETTINGS.md, docs/PYPI_README.md,
pyproject.toml and site/pages/*.html, plus the two the page layout adds (the
repository, from ``REPO`` in scripts/build-site.mjs, and the preprint's DOI,
from the README's citation), asks each one for its page (following
redirects), and prints what came back. It exits with 1 if any address fails.

The ``v1-final`` links work only once that tag is pushed. The old preview
address, which docs/REPO_SETTINGS.md quotes, passes if GitHub redirects it.
hello@biasclear.com cannot be checked from here; send it a test message.

Usage (from the root of this repo):
    python scripts/check_public_links.py
"""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [
    "README.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "docs/REPO_SETTINGS.md",
    "docs/PYPI_README.md",
    "pyproject.toml",
    *sorted(str(p.relative_to(ROOT)) for p in (ROOT / "site" / "pages").glob("*.html")),
]
# Addresses that are examples or templates, not links.
SKIP = re.compile(r"\$\{|example\.|<|\{\{")


def addresses() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for name in SOURCES:
        text = (ROOT / name).read_text(encoding="utf-8")
        for m in re.finditer(r"https://[^\s\"'<>)\]`]+", text):
            url = m.group(0).rstrip(".,;:")
            if SKIP.search(url):
                continue
            found.setdefault(url, []).append(name)
    layout = (ROOT / "scripts" / "build-site.mjs").read_text(encoding="utf-8")
    repo = re.search(r'export const REPO = "([^"]+)"', layout)
    doi = re.search(r"doi\s*=\s*\{([^}]+)\}", (ROOT / "README.md").read_text(encoding="utf-8"))
    for url in (repo and repo.group(1), doi and f"https://doi.org/{doi.group(1)}"):
        if url:
            found.setdefault(url, []).append("every page's header and footer")
    return found


def status(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "biasclear-link-check"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return str(response.status)
    except urllib.error.HTTPError as err:
        return str(err.code)
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return f"error: {getattr(err, 'reason', err)}"


def main() -> int:
    failed = 0
    for url, where in sorted(addresses().items()):
        got = status(url)
        ok = got.startswith("2")
        failed += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {got:>5}  {url}  ({', '.join(sorted(set(where)))})")
    print(f"{failed} failed" if failed else "every address answered")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
