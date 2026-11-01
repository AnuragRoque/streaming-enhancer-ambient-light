"""Builds the Chrome Web Store upload: dist/<short_name>-<version>.zip

Only files the extension uses go in: what manifest.json points at (background,
content scripts, popup, icons), the extension's own pages (EXTRA_PAGES) and what
those pages load, and _locales/ if present.
Docs, tests, the web site and tooling stay out.

It stops before zipping if something would get the upload rejected or ship a
mismatch: store length limits, a bad version, a missing file, or the version
constants in inject.js / player.js not matching the manifest.

Run from anywhere:  python scripts/package.py
"""
import json, os, re, sys, zipfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
FIXED_TIME = (2020, 1, 1, 0, 0, 0)  # same bytes for the same sources
# Pages the extension opens itself (chrome.runtime.getURL), which the manifest doesn't name.
EXTRA_PAGES = ['local.html']


def fail(msg):
    print('ERROR: ' + msg)
    sys.exit(1)


class Refs(HTMLParser):
    """Local files an HTML page loads (scripts, stylesheets, images)."""
    def __init__(self):
        super().__init__()
        self.files = set()

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        url = a.get('src') if tag in ('script', 'img') else a.get('href') if tag == 'link' else None
        if url and not re.match(r'^(?:[a-z]+:|//|#)', url):
            self.files.add(url.split('?')[0].split('#')[0])


def main():
    with open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)

    # --- store limits ----------------------------------------------------
    problems = []
    if len(m.get('name', '')) > 75: problems.append('name is %d characters (max 75)' % len(m['name']))
    if len(m.get('short_name', '')) > 12: problems.append('short_name is %d characters (max 12)' % len(m['short_name']))
    if len(m.get('description', '')) > 132: problems.append('description is %d characters (max 132)' % len(m['description']))
    version = m.get('version', '')
    if not re.fullmatch(r'\d+(\.\d+){0,3}', version) or any(int(p) > 65535 for p in version.split('.')):
        problems.append('version "%s" must be 1-4 dot-separated numbers, each 0-65535' % version)
    for name in ('inject.js', 'player.js'):
        with open(os.path.join(ROOT, name), encoding='utf-8') as f:
            found = re.search(r"var VERSION = '([^']*)'", f.read())
        if not found or found.group(1) != version:
            problems.append('%s says VERSION %s, manifest says %s' % (name, found.group(1) if found else '(none)', version))
    if problems:
        fail('not packaging:\n  - ' + '\n  - '.join(problems))

    # --- files -----------------------------------------------------------
    files = {'manifest.json'}
    if m.get('background', {}).get('service_worker'): files.add(m['background']['service_worker'])
    for cs in m.get('content_scripts', []):
        files.update(cs.get('js', []))
        files.update(cs.get('css', []))
    files.update((m.get('icons') or {}).values())
    action = m.get('action') or {}
    files.update((action.get('default_icon') or {}).values())
    for page in [action.get('default_popup'), m.get('options_page')] + EXTRA_PAGES:
        if not page: continue
        files.add(page)
        refs = Refs()
        with open(os.path.join(ROOT, page), encoding='utf-8') as f:
            refs.feed(f.read())
        base = os.path.dirname(page)
        files.update(os.path.normpath(os.path.join(base, r)).replace(os.sep, '/') for r in refs.files)
    for war in m.get('web_accessible_resources', []):
        files.update(war.get('resources', []))
    locales = os.path.join(ROOT, '_locales')
    if os.path.isdir(locales):
        for d, _, names in os.walk(locales):
            for n in names:
                files.add(os.path.relpath(os.path.join(d, n), ROOT).replace(os.sep, '/'))

    missing = sorted(f for f in files if not os.path.isfile(os.path.join(ROOT, f)))
    if missing:
        fail('these files are referenced but missing:\n  - ' + '\n  - '.join(missing))

    # --- zip ---------------------------------------------------------------
    os.makedirs(DIST, exist_ok=True)
    slug = re.sub(r'[^a-z0-9]+', '-', (m.get('short_name') or m['name']).lower()).strip('-')
    out = os.path.join(DIST, '%s-%s.zip' % (slug, version))
    total = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(os.path.join(ROOT, name), 'rb') as f:
                data = f.read()
            total += len(data)
            z.writestr(info, data)
            print('  %-24s %8d bytes' % (name, len(data)))
    print('\n%d files, %d kB unpacked -> %s (%d kB)' % (len(files), total // 1024, os.path.relpath(out, ROOT), os.path.getsize(out) // 1024))


if __name__ == '__main__':
    main()
