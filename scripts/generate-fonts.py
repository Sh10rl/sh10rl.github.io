# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]>=4.53"]
# ///
"""Subsets the site's fonts to the characters the built site shows.

Run it after `pnpm build` whenever posts change what the pages say, then build again:

    pnpm build && uv run scripts/generate-fonts.py && pnpm build

Chinese is set in Noto Serif SC. The index pages (/ and every /categories/<key>/) get one small
subset, `home`, so a first visit loads one Chinese font file. Every other character a page shows
goes into `articles`. Both are in src/styles/fonts-cjk.css, which every page loads. The Google
Fonts shards stay for text no page has yet (a search, a post written since the last run), less what
the subsets hold, in src/styles/fonts-cjk-shards.css, which loads after the page. The subsets are
recorded in noto-serif-sc/sources.json.

Latin is set in Source Serif 4. Its subset, `site`, holds ASCII and the other characters of Google's
Latin file that any page shows, in src/styles/fonts-latin.css; Google's file stays behind it in
src/styles/fonts.css for anything else. It is recorded in sources.json beside the files it comes
from.

scripts/font-coverage.ts reports at the end of a build when the subsets miss characters the pages
show.
"""

import hashlib
import json
import re
import tempfile
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
FONTS = ROOT / "src/assets/fonts"
FOLDER = FONTS / "noto-serif-sc"
CSS = ROOT / "src/styles/fonts-cjk.css"
SHARDS = ROOT / "src/styles/fonts-cjk-shards.css"
SOURCES = FOLDER / "sources.json"
HOME = "noto-serif-sc-home.woff2"
ARTICLES = "noto-serif-sc-articles.woff2"
SERIF_CSS = ROOT / "src/styles/fonts.css"
LATIN_CSS = ROOT / "src/styles/fonts-latin.css"
SERIF_SOURCES = FONTS / "sources.json"
SERIF = "source-serif-4-normal-latin.woff2"
SITE = "source-serif-4-normal-site.woff2"
# What browsers apply by themselves, and the figures the CSS asks for (font-variant-numeric:
# tabular-nums, proportional-nums). Fractions (frac, numr, dnom) go: nothing asks for them.
SERIF_FEATURES = ["calt", "ccmp", "clig", "kern", "liga", "locl", "mark", "mkmk", "pnum", "rlig", "rvrn", "tnum"]
# Nothing is set lighter than 400: the CSS uses 400 to 750, and bold inside bold can reach 900.
# The axis below 400 was a third of the file.
SERIF_WEIGHTS = (400, 900)
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Not set in the page's fonts: scripts and styles, inline icons, and Japanese, which the CSS sets
# in the system's Mincho (.sketch-credit :lang(ja)).
SKIP = {"script", "style", "template", "svg"}


class PageText(HTMLParser):
    """The characters a page shows: its text, and the placeholders of its fields."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []  # (tag, skipped)
        self.chars = set()

    def _skipped(self):
        return bool(self.stack) and self.stack[-1][1]

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        skipped = self._skipped() or tag in SKIP or (attrs.get("lang") or "").startswith("ja")
        if not skipped and attrs.get("placeholder"):
            self.chars.update(attrs["placeholder"])
        if tag not in VOID:
            self.stack.append((tag, skipped))

    def handle_startendtag(self, tag, attrs):
        attrs = dict(attrs)
        if not self._skipped() and attrs.get("placeholder"):
            self.chars.update(attrs["placeholder"])

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if not self._skipped():
            self.chars.update(data)


def codepoints(ranges):
    """The code points of a unicode-range value."""
    out = set()
    for start, end in re.findall(r"U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?", ranges):
        out.update(range(int(start, 16), int(end or start, 16) + 1))
    return out


def unicode_range(points):
    points = sorted(points)
    parts = []
    i = 0
    while i < len(points):
        j = i
        while j + 1 < len(points) and points[j + 1] == points[j] + 1:
            j += 1
        parts.append(f"U+{points[i]:X}" if i == j else f"U+{points[i]:X}-{points[j]:X}")
        i = j + 1
    return ", ".join(parts)


def face(family, file, points):
    return (
        "@font-face {\n"
        f"  font-family: '{family}';\n"
        "  font-style: normal;\n"
        "  font-weight: 200 900;\n"
        "  font-display: swap;\n"
        f"  src: url(../assets/fonts/{file}) format('woff2');\n"
        f"  unicode-range: {unicode_range(points)};\n"
        "}\n"
    )


def source_font(record):
    cached = Path(tempfile.gettempdir()) / f"NotoSerifSC-{record['sourceSHA256'][:16]}.ttf"
    if not cached.exists():
        print(f"downloading {record['source']}")
        data = urllib.request.urlopen(record["source"]).read()
        if hashlib.sha256(data).hexdigest() != record["sourceSHA256"]:
            raise SystemExit("The downloaded font does not match sourceSHA256 in sources.json.")
        cached.write_bytes(data)
    return cached


def write_subset(source, points, out):
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    font = subset.load_font(str(source), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    subset.save_font(font, str(out), options)


def chinese(index, other):
    """Noto Serif SC's two subsets, from what the index pages and the other pages show."""
    record = json.loads(SOURCES.read_text("utf-8"))
    faces = {}
    for css in (CSS, SHARDS):
        if css.exists():
            for file, ranges in re.findall(r"noto-serif-sc/([^)]+)\)[^}]*?unicode-range:\s*([^;]+);", css.read_text("utf-8")):
                faces[file] = codepoints(ranges)
    # Every code point the faces cover between them: the Chinese the page sets in Noto Serif SC.
    covered = set().union(*faces.values())

    # Each shard's own range, before the two subsets took their characters out of it.
    old = faces.get(HOME, set()) | faces.get(ARTICLES, set())
    shards = [entry["file"] for entry in record["files"] if entry["file"] not in (HOME, ARTICLES)]
    claimed = set()
    original = {}
    for file in shards:
        cmap = set(TTFont(FOLDER / file).getBestCmap())
        returned = (old & cmap) - claimed
        claimed |= returned
        original[file] = faces.get(file, set()) | returned

    home = index & covered
    articles = (other & covered) - home

    source = source_font(record)
    sizes = {}
    for file, points in ((HOME, home), (ARTICLES, articles)):
        before = (FOLDER / file).stat().st_size if (FOLDER / file).exists() else 0
        write_subset(source, points, FOLDER / file)
        sizes[file] = (FOLDER / file).stat().st_size
        print(f"{file}: {len(points)} characters, {sizes[file]:,} bytes (was {before:,})")

    def noto(file, points):
        return face("Noto Serif SC", f"noto-serif-sc/{file}", points)

    note = "Written by scripts/generate-fonts.py from the built pages; edit the script, not this file."
    CSS.write_text(
        f"/* Noto Serif SC 2.003: the two subsets that hold the Chinese the pages show, home for the\n"
        f"   index pages and articles for the rest. {note} */\n\n" + noto(HOME, home) + "\n" + noto(ARTICLES, articles),
        "utf-8",
    )
    blocks = [noto(file, original[file] - home - articles) for file in shards if original[file] - home - articles]
    SHARDS.write_text(
        f"/* Noto Serif SC 2.003: Google Fonts' shards, less what fonts-cjk.css holds, for Chinese no\n"
        f"   page shows yet. src/scripts/main.ts loads it once the page has. {note} */\n\n" + "\n".join(blocks),
        "utf-8",
    )
    print(f"{SHARDS.relative_to(ROOT)}: {len(blocks)} faces")

    for entry in record["files"]:
        if entry["file"] in (HOME, ARTICLES):
            points = home if entry["file"] == HOME else articles
            entry["subset"] = "".join(chr(point) for point in sorted(points))
            entry["bytes"] = sizes[entry["file"]]
    SOURCES.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", "utf-8")


def latin(shown):
    """Source Serif 4's `site` subset: ASCII and the rest of Google's Latin file that a page shows."""
    google = re.search(rf"{re.escape(SERIF)}\) format\('woff2'\);\s*unicode-range:\s*([^;]+);", SERIF_CSS.read_text("utf-8"))
    if not google:
        raise SystemExit(f"src/styles/fonts.css has no face for {SERIF}.")
    # ASCII always, control characters too: scripts write it, readers type it, and a character of
    # the Latin range outside the subset's would load Google's whole file. So would the characters
    # the browser draws itself: the hyphen of `hyphens: auto` in English prose, the ellipsis of
    # `text-overflow`, and the quotation marks of <q>.
    drawn = {0x2010, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026}
    points = set(range(0x80)) | drawn | (shown & codepoints(google.group(1)))
    font = TTFont(FONTS / SERIF, recalcTimestamp=False)
    instancer.instantiateVariableFont(font, {"wght": SERIF_WEIGHTS}, inplace=True)
    # Google's file has no U+2010, the hyphen browsers draw for `hyphens: auto`, so they looked for
    # it in the next face and fell back to the hyphen-minus. Here it is that same glyph.
    for table in font["cmap"].tables:
        if table.isUnicode() and 0x2D in table.cmap:
            table.cmap.setdefault(0x2010, table.cmap[0x2D])
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = SERIF_FEATURES
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    out = FONTS / SITE
    before = out.stat().st_size if out.exists() else 0
    subset.save_font(font, str(out), options)
    size = out.stat().st_size
    print(f"{SITE}: {len(points)} code points, {size:,} bytes (was {before:,})")

    weights = f"{SERIF_WEIGHTS[0]} {SERIF_WEIGHTS[1]}"
    LATIN_CSS.write_text(
        f"/* Source Serif 4 from {SERIF}: ASCII and the rest of the Latin the pages\n"
        f"   show, with weights {weights.replace(' ', ' to ')}. Defined after fonts.css, so browsers take it first for its\n"
        "   characters and load Google's file only for others; its descriptors are that face's, so the two\n"
        "   act as one font. Written by scripts/generate-fonts.py from the built pages; edit the script,\n"
        "   not this file. */\n\n" + face("Source Serif 4", SITE, points),
        "utf-8",
    )

    record = json.loads(SERIF_SOURCES.read_text("utf-8"))
    entry = next((item for item in record if item["file"] == SITE), None)
    if entry is None:
        entry = {}
        record.append(entry)
    entry.update({
        "style": "normal",
        "subset": "site",
        "from": SERIF,
        "weight": weights,
        "features": " ".join(SERIF_FEATURES),
        "unicodeRange": unicode_range(points),
        "file": SITE,
        "bytes": size,
    })
    SERIF_SOURCES.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", "utf-8")


def main():
    if not (DIST / "index.html").exists():
        raise SystemExit("No dist/index.html: run `pnpm build` first.")
    index = set()
    other = set()
    for page in sorted(DIST.rglob("*.html")):
        relative = page.relative_to(DIST).as_posix()
        parser = PageText()
        parser.feed(page.read_text("utf-8"))
        parser.close()
        points = {ord(char) for char in parser.chars}
        (index if relative == "index.html" or relative.startswith("categories/") else other).update(points)
    chinese(index, other)
    latin(index | other)


if __name__ == "__main__":
    main()
