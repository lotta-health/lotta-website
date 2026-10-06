#!/usr/bin/env node
// Builds the Lotta blog from the articles published in Ghost (https://between-appointments.ghost.io).
//
//   node build-blog.mjs             preview: writes blog/index.html, blog/<article>/index.html and assets/blog/* in this folder.
//                                   While Ghost has no article yet, the preview shows the seven sample articles instead (marked as samples),
//                                   so the layout can be seen; the live form never does this.
//   node build-blog.mjs --sample    preview with seven sample articles, into blog-sample/ (to judge the layout; never published)
//   node build-blog.mjs --live --out DIR --shell FILE
//                                   the form the live site uses (clean addresses such as /blog/meet-lotta/); run by deploy.mjs,
//                                   and by the refresh job on GitHub (github/publish.yml), where this file sits in tools/
//   --home FILE                     also rewrites the blog block on the home page in FILE: one article = the big cover, two or more = a row of
//                                   cards with the latest three. In the preview this is option-b.html by itself; the live form must be told.
//   node build-blog.mjs --stamp     prints a short fingerprint of what is published in Ghost right now, and writes nothing.
//                                   The refresh job compares it with blog/stamp.txt on the live site to see whether anything changed.
//
// For search engines and AI assistants it also writes, each time: sitemap.xml (the list of the site's addresses, with the date each
// article last changed), blog/rss.xml (the blog's feed), and inside every page the title, description, share picture and
// "structured data" (who published what, when, and where the page sits in the site). What the writer fills in under an article's
// settings in Ghost is honoured: "Meta title", "Meta description", "Canonical URL", the X/Facebook card fields, the picture's alt text,
// the excerpt, tags, and the author's own page (bio, website, LinkedIn). An empty field falls back to the article's own words.
//
// Each article is a folder with one page inside (blog/<article>/index.html). On GitHub Pages that gives every article exactly one
// address, /blog/<article>/, and the same address typed without the last slash is forwarded to it by GitHub itself. (A single file
// blog/<article>.html, the earlier form, answered at two addresses and gave "not found" for the form with a slash.)
//
// The menu and footer are lifted from an existing inner page (legal.html), so they can never drift from the rest of the site.
// The cards on the blog page are drawn by blog.js, which the page also loads to re-draw them when a topic is picked.
// Ghost is only read, never written: the key below is Ghost's read-only "Content API key", which Ghost itself calls safe to show in public.
// No dependencies: Node 18 or newer.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const GHOST = { url: 'https://between-appointments.ghost.io', key: '4ffd0f9db91245934494e9c46f' };
const SITE = 'https://www.lotta.health';
const BLOG = { name: 'Between Appointments', sub: 'Honest conversations about life on GLP-1s.', desc: 'Honest conversations about life on GLP-1s, from Lotta.' };
const TOPIC_ORDER = ['Considering', 'Starting', 'On treatment', 'Tapering', 'Maintaining'];   // the journey's own order first; other topics follow A to Z
const NEW_DAYS = 30;                                                                          // an article carries "New" for this long

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const LIVE = flag('live'); let SAMPLE = flag('sample');
if (LIVE && SAMPLE) { console.error('Sample articles are for the preview only; they cannot be built for the live site.'); process.exit(1); }
const OUT = opt('out', HERE), SHELL = opt('shell', join(HERE, 'legal.html'));
const DIR = SAMPLE ? 'blog-sample' : 'blog';
const HOME = opt('home', LIVE || SAMPLE ? '' : join(OUT, 'option-b.html'));
let stoodIn = false;        // true when the preview shows sample articles because Ghost has none yet
const warnings = [];
const warn = m => { warnings.push(m); };

/* The fingerprint: it changes when an article is published, edited, re-tagged or taken down, and when one stops being "New". */
const stampOf = list => createHash('sha1').update(JSON.stringify(list.map(g => [g.id, g.slug, g.published_at, g.updated_at, (g.tags || []).map(t => t.name), (g.authors || [g.primary_author]).filter(Boolean).map(a => [a.name, a.bio, a.website, a.linkedin, a.profile_image]), Date.now() - Date.parse(g.published_at) < NEW_DAYS * 864e5]))).digest('hex').slice(0, 16);
if (flag('stamp')) { console.log(stampOf(await fromGhost())); process.exit(0); }

// blog.js sits beside this file in the working folder, and one folder up when this file is in tools/ on GitHub
const BLOG_JS = [join(HERE, 'blog.js'), join(HERE, '..', 'blog.js'), join(OUT, 'blog.js')].find(existsSync);
if (!BLOG_JS) { console.error('Cannot find blog.js (it draws the cards on the blog page).'); process.exit(1); }
await import(pathToFileURL(BLOG_JS).href);
const { main: drawMain, cards: drawCards, pic: drawPic, esc, txt } = globalThis.LottaBlog;

/* ---------- addresses ---------- */
const listHref = LIVE ? './' : 'index.html';                       // from the blog page (blog/index.html)
const postHref = slug => LIVE ? slug + '/' : slug + '/index.html'; // an article, as seen from the blog page
const listUrl = SITE + '/blog/';
const postUrl = slug => `${SITE}/blog/${slug}/`;
// An article's page sits one folder further down (blog/<article>/index.html), so from there everything is one step further up.
const backToList = LIVE ? '../' : '../index.html';
const deeper = s => s ? String(s).replace(/(^|,\s*)\.\.\//g, '$1../../') : s;                    // a picture's address (or a list of them)
const fromPost = o => ({ ...o, href: '../' + o.href, img: deeper(o.img), srcset: deeper(o.srcset) });    // a card shown on an article page

/* ---------- the menu and footer, from an existing inner page ---------- */
if (!existsSync(SHELL)) { console.error(`Cannot find ${SHELL} (the page the menu and footer are taken from). Run python3 make-pages.py first.`); process.exit(1); }
const shellSrc = readFileSync(SHELL, 'utf8');
const grab = (re, what) => { const m = shellSrc.match(re); if (!m) { console.error(`Could not find the ${what} in ${SHELL}.`); process.exit(1); } return m[0]; };
const up = html => html.replace(/\b(href|src)="(?!#|\/|https?:|mailto:|tel:|data:)([^"]*)"/g, '$1="../$2"');   // the blog pages sit one folder down
const current = html => html.replace(/ aria-current="page"/g, '').replace(/(<a href="[^"]*blog\/(?:index\.html)?")>(<span>)?Blog</g, '$1 aria-current="page">$2Blog<');
const NAV = current(up(grab(/<header class="nav">[\s\S]*?<\/header>/, 'menu') + '\n' + ((shellSrc.match(/<!-- sheet -->[\s\S]*?<!-- \/sheet -->/) || [''])[0])));   // the menu bar and, with it, the phone menu
const FOOT = current(up(grab(/<footer class="foot">[\s\S]*?<\/footer>/, 'footer')));
const up2 = html => html.replace(/\b(href|src)="\.\.\//g, '$1="../../');                          // the same pieces, for a page one folder further down
const ICON = up((shellSrc.match(/<link rel="(?:icon|apple-touch-icon)"[^>]*>/g) || []).join('\n'));   // the icon files sit at the site's root

/* ---------- the articles ---------- */
const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Lisbon' });
const plain = s => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { s = plain(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };

async function fromGhost() {
  const out = [];
  for (let page = 1; page; ) {
    const u = `${GHOST.url}/ghost/api/content/posts/?key=${GHOST.key}&include=tags,authors&formats=html&order=published_at%20desc&limit=50&page=${page}`;
    const r = await fetch(u, { headers: { 'Accept-Version': 'v5.0' } });
    if (!r.ok) throw new Error(`Ghost answered ${r.status} for the list of articles`);
    const j = await r.json();
    out.push(...j.posts);
    page = j.meta?.pagination?.next || 0;
  }
  // Ghost's own starter post ("Coming soon") is not an article of ours.
  return out.filter(p => !(p.slug === 'coming-soon' && /brand new site by/.test(p.html || p.excerpt || '')));
}

const SAMPLE_BODY = `<p><em>Placeholder text, to show the layout.</em></p>
<p>Most of the GLP-1 journey doesn't happen inside a doctor's office.</p>
<h2>The gap between appointments</h2>
<p>An appointment is short. The weeks between are long, and that is where the questions arrive. Is this right for me? How do I actually do this in real life? Is this normal, or am I doing it wrong?</p>
<p>Those questions are part of the journey. They deserve somewhere to go.</p>
<h2>What Lotta is</h2>
<p>Lotta is a long-term support platform designed to help people navigate every stage of their GLP-1 journey, combining evidence-based guidance, practical tools and compassionate support to create lasting lifestyle change.</p>
<blockquote>“My body changed, but my head has not caught up.”</blockquote>
<h2>What Lotta is not</h2>
<p>Lotta does not replace healthcare professionals. It sits beside the care you already have, for the days in between.</p>
<h2>What comes next</h2>
<p>Lotta opens on iOS in November. The beta list is open now.</p>`;
const SAMPLES = [
  ['meet-lotta', "Meet Lotta: why we're building it", "Most of the GLP-1 journey doesn't happen inside a doctor's office.", 'Inside Lotta', '2026-11-03', 5, 'meet.jpg', '50% 45%'],
  ['between-appointments', 'What happens between appointments?', 'The weeks between visits are where most of the questions arrive.', 'Starting', '2026-10-27', 4, 'flowers.jpg', ''],
  ['not-magic', 'Not magic. Not cheating.', 'A GLP-1 can make change possible. It does not make the journey effortless and it is not cheating.', 'On treatment', '2026-10-20', 6, 'dunes.jpg', '60% 30%'],
  ['after-the-goal', 'The journey after the goal', 'Reaching a goal is not the end of a GLP-1 journey.', 'Maintaining', '2026-10-13', 5, 'flower.webp', '40% 50%'],
  ['sustainable-progress', 'What does sustainable progress actually mean?', 'Is this normal? Am I doing it wrong?', 'On treatment', '2026-10-06', 5, 'sand.jpg', '50% 70%'],
  ['head-not-caught-up', 'My body changed, but my head has not caught up', 'What tapering can feel like, and what helps.', 'Tapering', '2026-09-29', 7, 'wave.jpg', ''],
  ['right-for-me', 'Is this right for me?', 'What to expect before you start.', 'Considering', '2026-09-22', 4, 'sunrise.jpg', '50% 60%'],
].map(([slug, title, excerpt, tag, day, read, pic, pos]) => ({ slug, title, custom_excerpt: excerpt, excerpt, html: SAMPLE_BODY, reading_time: read, published_at: day + 'T09:00:00.000+00:00', updated_at: day + 'T09:00:00.000+00:00',
  tags: [{ name: tag, visibility: 'public' }], primary_tag: { name: tag }, primary_author: { name: 'The Lotta team' }, _img: '../blog-layouts/pics/' + pic, _pos: pos }));

/* ---------- pictures: copied next to the site, so the pages do not depend on Ghost being up ---------- */
const ghostImage = u => /\/content\/images\//.test(u) && (u.startsWith(GHOST.url + '/') || u.startsWith('https://storage.ghost.io/'));   // Ghost(Pro) keeps uploads on storage.ghost.io
const sized = (u, w, webp) => ghostImage(u) && !/\.(svg|gif)(\?|$)/i.test(u) && !u.includes('/content/images/size/') ? u.replace('/content/images/', `/content/images/size/w${w}/${webp ? 'format/webp/' : ''}`) : u;   // Ghost's own picture service resizes and converts
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
async function keep(url, name, width, webp) {      // -> the picture's address as seen from a page inside blog/, or the original address if it cannot be fetched
  try {
    const r = await fetch(sized(url, width, webp));
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !EXT[type]) throw new Error(`${r.status} ${type}`);
    const file = `${name}.${EXT[type]}`;
    mkdirSync(join(OUT, 'assets', 'blog'), { recursive: true });
    writeFileSync(join(OUT, 'assets', 'blog', file), Buffer.from(await r.arrayBuffer()));
    return { href: '../assets/blog/' + file, abs: `${SITE}/assets/blog/${file}` };
  } catch (e) { warn(`could not copy the picture ${url} (${e.message}); the page points at Ghost for it instead`); return { href: url, abs: url }; }
}
function fallbackCover() {
  const src = [join(OUT, 'assets', 'wave-poster.jpg'), join(HERE, 'assets', 'wave-poster.jpg'), join(HERE, '..', 'assets', 'wave-poster.jpg')].find(existsSync);
  if (!src) return { href: '', abs: '' };
  mkdirSync(join(OUT, 'assets', 'blog'), { recursive: true });
  copyFileSync(src, join(OUT, 'assets', 'blog', 'cover-default.jpg'));
  return { href: '../assets/blog/cover-default.jpg', abs: `${SITE}/assets/blog/cover-default.jpg` };
}
async function replaceAsync(s, re, fn) { const jobs = []; s.replace(re, (...m) => { jobs.push(fn(...m)); return ''; }); const done = await Promise.all(jobs); return s.replace(re, () => done.shift()); }

const REF_TAG = new RegExp('([?&])ref=' + new URL(GHOST.url).host.replace(/\./g, '\\.') + '(&?)');                   // Ghost's own tag on outgoing links, wherever it sits in the address
const GHOST_LINK = new RegExp('href="' + GHOST.url.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '/([^"/]*)/?"', 'g');   // a link in an article to another page of the Ghost copy
let raw = SAMPLE ? SAMPLES : await fromGhost();
if (!raw.length && !LIVE) { raw = SAMPLES; SAMPLE = true; stoodIn = true; }
const slugs = new Set(raw.map(p => p.slug));
const now = Date.now();
const posts = [];
for (const g of raw) {
  const tags = (g.tags || []).filter(t => t.visibility !== 'internal' && !String(t.name).startsWith('#')).map(t => t.name);
  const p = {
    slug: g.slug, title: plain(g.title), excerpt: plain(g.custom_excerpt), tag: tags[0] || '', tags,
    desc: clip(g.meta_description || g.custom_excerpt, 160),          // if both are empty in Ghost, it is taken from the article's first sentences, further down
    iso: g.published_at, mod: g.updated_at || g.published_at, date: fmtDate(g.published_at), read: Math.max(1, g.reading_time || 1) + ' min read',
    isNew: now - Date.parse(g.published_at) < NEW_DAYS * 864e5, author: g.primary_author?.name || 'The Lotta team',
    credit: g.feature_image_caption || '', href: postHref(g.slug), pos: g._pos || '',
    // what the writer filled in under the article's settings in Ghost (empty when left blank)
    metaTitle: plain(g.meta_title), canonical: /^https?:\/\//.test(g.canonical_url || '') ? g.canonical_url : '',
    ogTitle: plain(g.og_title || g.twitter_title), ogDesc: plain(g.og_description || g.twitter_description),
    words: plain(String(g.html || '').replace(/<[^>]+>/g, ' ')).split(' ').filter(Boolean).length,
    by: (g.authors?.length ? g.authors : [g.primary_author]).filter(Boolean).map(a => ({ name: plain(a.name), bio: plain(a.bio), site: a.website || '',
      same: [a.linkedin && 'https://www.linkedin.com/' + String(a.linkedin).replace(/^\//, ''), a.instagram && 'https://www.instagram.com/' + String(a.instagram).replace(/^@/, '')].filter(Boolean) })),
  };
  const cover = g._img ? { href: g._img, abs: '' } : g.feature_image ? await keep(g.feature_image, g.slug, 1600) : fallbackCover();
  if (!g._img && !g.feature_image) warn(`"${p.title}" has no feature picture in Ghost; it shows the default picture`);
  p.img = cover.href; p.imgAbs = cover.abs; p.srcset = ''; p.alt = plain(g.feature_image_alt);
  const shareSrc = g.og_image || g.twitter_image;                  // a separate picture for link previews, if one was set in Ghost
  p.share = shareSrc && !g._img ? (await keep(shareSrc, g.slug + '-share', 1200)).abs : '';
  /* Lighter copies of the cover for the pages themselves (audit A4): the WebP format at three widths, so a phone fetches a file a
     fifth of the size. The JPEG above stays as the fallback and is the one named for link previews and search engines. */
  if (g.feature_image && ghostImage(g.feature_image) && cover.href.startsWith('../')) {
    const set = [];
    for (const w of [800, 1200, 1600]) { const v = await keep(g.feature_image, `${g.slug}-${w}`, w, true); if (v.href.startsWith('../') && v.href.endsWith('.webp')) set.push([v.href, w]); }
    if (set.length) { p.srcset = set.map(([h, w]) => `${h} ${w}w`).join(', '); p.imgS = set[0][0]; p.imgL = set[set.length - 1][0]; }
  }
  p.face = g.primary_author?.profile_image ? (await keep(g.primary_author.profile_image.replace(/^\/\//, 'https://'), 'author-' + (g.primary_author.slug || 'x'), 160)).href : '';
  // the article's own words: pictures are copied over, links to the Ghost copy point at our pages instead
  let n = 0, html = g.html || '';
  html = await replaceAsync(html, /<img\b[^>]*>/g, async tag => {
    const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1];
    if (!src || !ghostImage(src)) return tag;
    const k = await keep(src.replace(/\/content\/images\/size\/w\d+\//, '/content/images/'), `${g.slug}-${++n}`, 1400);
    let t = tag.replace(/\s(srcset|sizes)="[^"]*"/g, '').replace(/\bsrc="[^"]+"/, `src="${k.href}"`);
    if (!/\bloading=/.test(t)) t = t.replace(/<img\b/, '<img loading="lazy" decoding="async"');
    return t;
  });
  html = html.replace(GHOST_LINK, (m, s) => `href="${slugs.has(s) ? postHref(s) : listHref}"`);
  // A short line that is entirely bold is a section heading (Margarida's rule, 5 Oct): text pasted from Word or Google Docs arrives that way.
  // Not when it ends like a sentence or a label (. , ; :), and not when it is longer than 80 characters.
  html = html.replace(/<p>\s*<(strong|b)>([^<]{2,80})<\/\1>\s*(?:<br\s*\/?>)?\s*<\/p>/g, (m, t, text) => /[.,;:]\s*$/.test(text.replace(/&nbsp;/g, ' ')) ? m : `<h2>${text.trim()}</h2>`);
  // The article's title is the page's main heading, so its sections are second-level headings whichever size was picked in Ghost:
  // an article written with only the smaller heading has its headings moved up one size.
  if (!/<h2[\s>]/i.test(html) && /<h3[\s>]/i.test(html)) html = html.replace(/<(\/?)h([3-5])(\s[^>]*)?>/gi, (m, c, n, a = '') => `<${c}h${n - 1}${a}>`);
  // a heading typed in bold is still just a heading: the bold is dropped so all headings look alike
  html = html.replace(/<(h[2-4])(\s[^>]*)?>\s*<(strong|b)>([\s\S]*?)<\/\3>\s*<\/\1>/gi, (m, h, a = '', t, inner) => `<${h}${a}>${inner}</${h}>`);
  // Ghost adds "?ref=<its own address>" to links that leave it; that address is private, so the addition is removed
  html = html.replace(/href="([^"]*)"/g, (m, u) => `href="${u.replace(REF_TAG, (x, a, b) => b ? a : '').replace(/[?&]$/, '')}"`);
  // every section heading gets a name of its own, so a list of sections can point at it later
  const seen = new Set();
  html = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (m, attrs = '', inner) => {
    if (/\bid=/.test(attrs)) return m;
    let id = plain(inner.replace(/<[^>]+>/g, '')).toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });
  // No description written in Ghost: the article's own opening sentences (whole sentences from its paragraphs, never a heading,
  // never cut in the middle), up to about 160 characters. Search engines show this under the page's title.
  if (!p.desc) {
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => plain(m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"'))).filter(t => t.length > 40);
    let d = '';
    for (const sentence of paras.join(' ').match(/[^.!?]+[.!?]+(?=\s|$)/g) || []) { if (d && (d + sentence).length > 165) break; d += sentence; if (d.length > 110) break; }
    p.desc = d.trim().length > 200 ? clip(d, 160) : d.trim() || clip(g.excerpt, 160);
    if (!g._img) warn(`"${p.title}" has no excerpt or meta description in Ghost; search engines are shown its opening sentences instead: "${p.desc}"`);
  }
  if (!g._img && !p.alt) warn(`"${p.title}": its cover picture has no description (alt text) in Ghost; people using a screen reader, and search engines, get none`);
  const left = plain(html.replace(/<[^>]+>/g, ' ')).match(/\[[^\]\n]{2,40}\]/g);
  if (left) warn(`"${p.title}" still has ${left.length === 1 ? 'a placeholder' : 'placeholders'} in its text: ${[...new Set(left)].join(', ')}`);
  if (/<(script|iframe)\b/i.test(html)) warn(`"${p.title}" embeds something from another site (a video, a post, a script). Such embeds can set cookies on visitors: check before publishing.`);
  p.html = html;
  posts.push(p);
}
// what the page hands to blog.js: only what the cards need
const lean = posts.map(({ slug, title, excerpt, tag, tags, date, read, isNew, img, srcset, pos, href }) => ({ slug, title, excerpt, tag, tags, date, read, isNew, img, srcset, pos, href }));
const used = [...new Set(posts.flatMap(p => p.tags))];
const topics = [...TOPIC_ORDER.filter(t => used.includes(t)), ...used.filter(t => !TOPIC_ORDER.includes(t)).sort((a, b) => a.localeCompare(b))];

/* ---------- the pieces of a page ---------- */
const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
function head({ title, desc, url, image, type, ld, og = {}, extra = '', deep = false }) {
  const root = deep ? '../../' : '../';                    // the way back to the site's root from this page
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SAMPLE ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">\n<meta name="robots" content="max-image-preview:large">`}
<meta property="og:site_name" content="Lotta">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(og.title || title.replace(/ · Lotta$/, ''))}">
<meta property="og:description" content="${esc(og.desc || desc)}">
<meta property="og:url" content="${url}">
${image ? `<meta property="og:image" content="${esc(image)}">${og.alt ? `\n<meta property="og:image:alt" content="${esc(og.alt)}">` : ''}\n<meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}${extra ? '\n' + extra : ''}
${deep ? up2(ICON) : ICON}${SAMPLE ? '' : `\n<link rel="alternate" type="application/rss+xml" title="${esc(BLOG.name)}, the Lotta blog" href="${deep ? '../' : ''}rss.xml">`}
<meta name="theme-color" content="#F9F5EF">
<link rel="preload" href="${root}assets/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${root}assets/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}pages.css">
${ld && !SAMPLE ? `<script type="application/ld+json">${json(ld)}</script>` : ''}
<script>
  /* A page opened by a link starts at its top, whatever the browser carried over from the page before; Back, Forward and reload keep their place. */
  (function () { try { var n = performance.getEntriesByType('navigation')[0]; if (!location.hash && (!n || n.type === 'navigate')) { var top = function () { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }; top(); document.addEventListener('DOMContentLoaded', top); window.addEventListener('pageshow', function (e) { if (!e.persisted) top(); }); } } catch (e) {} })();
  /* viewer message: highlight placeholder words (same switch as the home page) */
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'lotta-ph') document.documentElement.classList.toggle('show-ph', !!e.data.on); });
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${deep ? up2(NAV) : NAV}
`;
}
const NL_FORM = `<form class="nl-form" id="nl-form" novalidate onsubmit="return false">
          <input id="nl-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="Your e-mail" aria-label="Your e-mail" required>
          <button class="btn btn-primary" type="submit">Subscribe</button>
        </form>
        <p class="nl-err" id="nl-err" role="alert" hidden>Please enter a valid e-mail address.</p>
        <p class="nl-err" id="nl-fail" role="alert" hidden><span class="ph">That didn't go through. Please try again, or write to hello@lotta.health.</span></p>
        <p class="nl-thanks" id="nl-thanks" tabindex="-1" hidden>Thank you. We've sent you a welcome e-mail.</p>`;
// The almond sign-up box that used to close the blog page and every article was taken out on 5 Oct 2026:
// the footer now carries the newsletter sign-up on every page.
const EMPTY = `<section class="jr-empty" aria-labelledby="jr-empty-h">
        <h2 id="jr-empty-h"><span class="ph">The first articles are on their way.</span></h2>
        <p><span class="ph">Get them in your inbox as soon as they are out.</span></p>
        ${NL_FORM}
      </section>`;
const NL_JS = `<script>
(function () {
  var f = document.getElementById('nl-form'), i = document.getElementById('nl-email'), err = document.getElementById('nl-err'), fail = document.getElementById('nl-fail'), th = document.getElementById('nl-thanks');
  if (!f) return;
  var OK = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = i.value.trim();
    if (!OK.test(v)) { err.hidden = false; i.setAttribute('aria-invalid', 'true'); i.focus(); return; }
    err.hidden = true; fail.hidden = true; i.removeAttribute('aria-invalid');
    if (!window.lottaDeliver) { fail.hidden = false; return; }
    window.lottaDeliver('newsletter', { email: v }, f.querySelector('button'), function (sent) {   // the thank-you only once it has really left
      if (sent) { f.hidden = true; th.hidden = false; th.focus({ preventScroll: true }); }
      else fail.hidden = false;
    });
  });
})();
</script>`;
const TAIL = (extra, deep = false) => `
${deep ? up2(FOOT) : FOOT}
${SAMPLE ? '<p class="bl-sample">Sample articles, to show the layout</p>' : ''}
<script src="${deep ? '../../' : '../'}site.js" defer></script>
${extra}
</body>
</html>
`;
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ORG_ID = SITE + '/#organization', SITE_ID = SITE + '/#website';     // the same names the home page gives the company and the site
const ORG = { '@type': 'Organization', '@id': ORG_ID, name: 'Lotta', url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/assets/lotta-logo.png', width: 2400, height: 761 } };
const isTeam = n => /\bteam\b/i.test(n) || /^lotta$/i.test(n);            // "Lotta Team" is the company writing, not a person

/* ---------- the blog page ---------- */
function listPage() {
  const pills = posts.length > 1 && topics.length > 1
    ? `\n        <div class="bl-pills" role="group" aria-label="Filter by topic"><span>Filter by:</span><button type="button" data-tag="" aria-pressed="true">All</button>${topics.map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>` : '';
  return head({ title: `Blog · ${BLOG.name} · Lotta`, desc: BLOG.desc, url: listUrl, image: posts[0]?.imgAbs, type: 'website',
    ld: { '@context': 'https://schema.org', '@type': 'Blog', '@id': listUrl + '#blog', name: BLOG.name, description: BLOG.desc, url: listUrl, inLanguage: 'en', publisher: ORG, isPartOf: { '@id': SITE_ID },
      blogPost: posts.slice(0, 30).map(p => ({ '@type': 'BlogPosting', headline: p.title, url: p.canonical || postUrl(p.slug), datePublished: p.iso, dateModified: p.mod })) } }) + `
<main id="main">
  <div class="page blog">
    <div class="wrap">
      <header class="bl-head">
        <h1 class="bl-title">${esc(BLOG.name)}</h1>
        <p class="bl-sub">${txt(BLOG.sub)}</p>${pills}
      </header>
      ${posts.length ? `<div class="bl-main" id="bl-main">${drawMain(lean)}</div>` : EMPTY}
    </div>
  </div>
</main>
` + TAIL(posts.length ? `<script type="application/json" id="bl-data">${json(lean)}</script>\n<script src="../blog.js" defer></script>\n` : NL_JS);   // the small sign-up script is only needed while the blog is empty
}

/* ---------- one article ---------- */
function postPage(p) {
  const others = lean.filter(o => o.slug !== p.slug).slice(0, 3).map(fromPost);
  const face = p.face ? `<i style="background-image:url('${esc(deeper(p.face))}')"></i>` : '<i><span class="logo"></span></i>';
  // the article's own pictures, and its links to other articles, as seen from one folder further down
  const body = p.html.replace(/\b(src|href)="\.\.\//g, '$1="../../').replace(/\bhref="(?!#|\/|\.\.\/|https?:|mailto:|tel:)([^"]*)"/g, 'href="../$1"');
  const url = p.canonical || postUrl(p.slug);
  const authors = (p.by.length ? p.by : [{ name: p.author, bio: '', site: '', same: [] }]).map(a => isTeam(a.name) ? { '@type': 'Organization', '@id': ORG_ID, name: 'Lotta', url: SITE + '/' }
    : { '@type': 'Person', name: a.name, description: a.bio || undefined, url: a.site || a.same[0] || undefined, sameAs: a.same.length ? a.same : undefined });
  return head({ deep: true, title: p.metaTitle || `${p.title} · Lotta`, desc: p.desc || BLOG.desc, url, image: p.share || p.imgAbs, type: 'article',
    og: { title: p.ogTitle || p.title, desc: p.ogDesc, alt: p.share ? '' : p.alt },
    extra: `<meta property="article:published_time" content="${esc(p.iso)}">\n<meta property="article:modified_time" content="${esc(p.mod)}">${p.tag ? `\n<meta property="article:section" content="${esc(p.tag)}">` : ''}`,
    ld: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'BlogPosting', '@id': url + '#article', headline: p.title, description: p.desc, image: p.imgAbs ? [p.imgAbs] : undefined, datePublished: p.iso, dateModified: p.mod,
        author: authors.length === 1 ? authors[0] : authors, publisher: ORG, mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url, inLanguage: 'en', wordCount: p.words || undefined,
        articleSection: p.tag || undefined, keywords: p.tags.length ? p.tags.join(', ') : undefined, isPartOf: { '@type': 'Blog', '@id': listUrl + '#blog', name: BLOG.name, url: listUrl } },
      { '@type': 'BreadcrumbList', itemListElement: [['Lotta', SITE + '/'], [BLOG.name, listUrl], [p.title, url]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) },
    ] } }) + `
<main id="main">
  <article class="art">
    <div class="wrap">
      <header class="bl-ph art-cover">
        ${drawPic(fromPost(p), '(min-width:1336px) 1240px, 100vw', true).replace(' alt=""', ` alt="${esc(p.alt)}"`)}
        <div class="bl-in">
          <p class="bl-meta">${p.tag ? `<span class="bl-new">${esc(p.tag)}</span>` : ''}${esc(p.read)}</p>
          <h1 class="bl-t">${txt(p.title)}</h1>${p.excerpt ? `\n          <p class="bl-hook">${txt(p.excerpt)}</p>` : ''}
        </div>
      </header>${p.credit ? `\n      <p class="art-credit">${p.credit}</p>` : ''}
      <div class="art-under">
        <a class="art-back" href="${backToList}">${BACK}All articles</a>
        <p class="art-by">${face}<span><b>${esc(p.author)}</b> · <time datetime="${esc(p.iso)}">${esc(p.date)}</time></span></p>
      </div>
      <div class="art-prose">
${body}
      </div>
      <div class="art-end">
        <a class="art-back" href="${backToList}">${BACK}All articles</a>
        <button class="art-share" type="button" id="art-share" data-url="${url}">Copy link</button>
      </div>${others.length ? `
      <section class="art-more" aria-labelledby="art-more-h">
        <h2 class="bl-h" id="art-more-h">Keep reading</h2>
        <ul class="bl-grid">${drawCards(others)}</ul>
      </section>` : ''}
    </div>
  </article>
</main>
` + TAIL(`
<script>
(function () {
  var b = document.getElementById('art-share'); if (!b) return;
  b.addEventListener('click', function () {
    var done = function () { b.textContent = 'Link copied'; setTimeout(function () { b.textContent = 'Copy link'; }, 2400); };
    try { navigator.clipboard.writeText(b.getAttribute('data-url')).then(done, function () { window.prompt('Copy this link:', b.getAttribute('data-url')); }); }
    catch (e) { window.prompt('Copy this link:', b.getAttribute('data-url')); }
  });
})();
</script>`, true);
}

/* ---------- the home page's blog block ----------
   One article: the big cover, whose button opens it. Two or more: a row of cards with the latest three, each opening its article
   (the original "Sunrise" blog block). People reach the blog page itself from the top menu, so the block has no link to it. */
const fromHome = u => u.replace(/^\.\.\//, '');                                  // an address as seen from the home page, not from inside blog/
function homeBlock(list) {
  if (list.length === 1) {
    const p = list[0], img = fromHome(p.imgL || p.img), imgS = fromHome(p.imgS || '');
    return `
    <article class="cover rv">
      <div class="bg-late cover-img" aria-hidden="true"><div class="ci"${img ? ` style="--cover:url('${esc(img)}')${imgS ? `; --cover-s:url('${esc(imgS)}')` : ''}"` : ''}></div></div>
      <div class="cover-body">
        <p class="cover-meta">${p.isNew ? '<span class="cover-new">New</span>' : p.tag ? `<span class="cover-new">${esc(p.tag)}</span>` : ''}<span>${esc(p.read)}</span></p>
        <h3 class="cover-t"><a class="cover-link post-link" href="${DIR}/${postHref(p.slug)}">${txt(p.title)}</a></h3>${p.excerpt ? `\n        <p class="cover-hook">${txt(p.excerpt)}</p>` : ''}
        <span class="cover-cta" aria-hidden="true">Read the article<svg aria-hidden="true"><use href="#i-arrow"/></svg></span>
      </div>
    </article>
    `;
  }
  const three = list.slice(0, 3);
  return `
    <ul class="posts${three.length === 2 ? ' posts-2' : ''}" data-stagger>${three.map(p => {
    const img = fromHome(p.imgS || p.img), url = postUrl(p.slug);
    return `
      <li class="post">
        <article class="post-card">
          <div class="bg-late post-img"><div class="pi"${img ? ` style="background-image:url('${esc(img)}')"` : ''}></div>${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}</div>
          <div class="post-body">
            <h3 class="post-t"><a class="post-link" href="${DIR}/${postHref(p.slug)}">${txt(p.title)}</a></h3>${p.excerpt ? `\n            <p class="post-hook">${txt(p.excerpt)}</p>` : ''}
            <div class="post-meta"><span>${esc(p.read)}</span><button class="share" type="button" data-url="${url}"><svg class="i-ln" aria-hidden="true"><use href="#i-link"/></svg><svg class="i-ok" aria-hidden="true"><use href="#i-check"/></svg><span class="share-l">Share</span></button></div>
            <p class="share-url" hidden>${url}</p>
            <p class="share-status sr-only" aria-live="polite"></p>
          </div>
        </article>
      </li>`; }).join('')}
    </ul>
    `;
}
const MARK = /(<!-- blog:latest[\s\S]*?-->)[\s\S]*?(<!-- \/blog:latest -->)/;
let homeNote = '';
if (HOME && !SAMPLE) {
  if (!existsSync(HOME)) warn(`the home page ${HOME} was not found, so its blog block was not updated`);
  else if (!posts.length) homeNote = 'The home page\'s blog block was left as it is: no article is published.';
  else {
    const page = readFileSync(HOME, 'utf8');
    if (!MARK.test(page)) warn('the home page has no "blog:latest" marks, so its blog block was not updated');
    else {
      writeFileSync(HOME, page.replace(MARK, (m, a, b) => a + homeBlock(posts) + b));
      homeNote = posts.length === 1 ? `The home page's blog block shows "${posts[0].title}" and its button opens that article.` : `The home page's blog block shows the latest ${Math.min(3, posts.length)} articles as a row of cards.`;
    }
  }
}
// with the sample articles: a copy of the home page whose blog block shows them, to judge the row of cards (preview only)
if (flag('sample') && existsSync(join(OUT, 'option-b.html'))) {
  const page = readFileSync(join(OUT, 'option-b.html'), 'utf8');
  if (MARK.test(page)) { writeFileSync(join(OUT, 'option-b-blog-sample.html'), page.replace(MARK, (m, a, b) => a + homeBlock(posts) + b)); homeNote = 'A copy of the home page with the sample articles in its blog block: option-b-blog-sample.html'; }
}

/* ---------- write ---------- */
const dir = join(OUT, DIR);
mkdirSync(dir, { recursive: true });
// this folder belongs to the builder: articles taken down in Ghost disappear here too (as do the single-file pages of the earlier form)
for (const f of readdirSync(dir, { withFileTypes: true })) {
  if (f.isFile() && f.name.endsWith('.html')) rmSync(join(dir, f.name));
  else if (f.isDirectory() && existsSync(join(dir, f.name, 'index.html'))) rmSync(join(dir, f.name), { recursive: true });
}
writeFileSync(join(dir, 'index.html'), listPage());
if (!SAMPLE) writeFileSync(join(dir, 'stamp.txt'), stampOf(raw) + '\n');     // what the refresh job compares against
for (const p of posts) { mkdirSync(join(dir, p.slug), { recursive: true }); writeFileSync(join(dir, p.slug, 'index.html'), postPage(p)); }
if (DIR === 'blog') {
  // The stand-in page blog.html (which handed the old address over to the blog page) is gone: while it existed, the address /blog
  // answered with it. Without it GitHub forwards /blog to /blog/ by itself, and the "not found" page sends /blog.html there too.
  const old = join(OUT, 'blog.html');
  if (existsSync(old) && /http-equiv="refresh"/.test(readFileSync(old, 'utf8'))) rmSync(old);
}
/* ---------- for search engines: the list of the site's addresses, and the blog's feed ---------- */
if (!SAMPLE) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const stamp = iso => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const newest = posts.length ? new Date(Math.max(...posts.map(p => Date.parse(p.mod)))).toISOString() : '';
  // The home page and the blog page change when an article does, so they carry the newest article's date; the legal page carries none
  // (a date is only useful to a search engine when it is true, and this builder does not know when it was last edited).
  // Only /legal is listed: /privacy and /terms repeat its text and point to it as the one to keep.
  const rows = [[SITE + '/', newest], [listUrl, newest], ...posts.filter(p => !p.canonical).map(p => [postUrl(p.slug), p.mod]), [`${SITE}/legal`, '']];
  writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.map(([loc, mod]) => `  <url><loc>${x(loc)}</loc>${mod ? `<lastmod>${stamp(mod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(dir, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>${x(BLOG.name)}</title>
  <link>${listUrl}</link>
  <description>${x(BLOG.desc)}</description>
  <language>en</language>
  <atom:link href="${listUrl}rss.xml" rel="self" type="application/rss+xml"/>${newest ? `\n  <lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>` : ''}
${posts.slice(0, 50).map(p => `  <item>
    <title>${x(p.title)}</title>
    <link>${x(p.canonical || postUrl(p.slug))}</link>
    <guid isPermaLink="true">${x(postUrl(p.slug))}</guid>
    <pubDate>${new Date(p.iso).toUTCString()}</pubDate>
    <dc:creator>${x(p.author)}</dc:creator>${p.tags.map(t => `\n    <category>${x(t)}</category>`).join('')}
    <description>${x(p.desc || p.excerpt)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`);
}
console.log(`${stoodIn ? 'Blog (preview form), SAMPLE ARTICLES because Ghost has none yet' : SAMPLE ? 'Sample blog' : LIVE ? 'Blog (live form)' : 'Blog (preview form)'}: ${posts.length} article${posts.length === 1 ? '' : 's'} written to ${dir}`);
for (const p of posts) console.log(`  ${p.date.padEnd(13)} ${p.slug}${p.tags.length ? '   [' + p.tags.join(', ') + ']' : ''}`);
if (!posts.length) console.log('  No articles are published in Ghost yet: the blog page shows "The first articles are on their way."');
if (homeNote) console.log('  ' + homeNote);
if (!SAMPLE) console.log(`  For search engines: sitemap.xml (${posts.length + 3} addresses) and ${DIR}/rss.xml (the feed).`);
if (warnings.length) { console.log(`\nWARNINGS (${warnings.length}):`); for (const w of warnings) console.log('  ! ' + w); }
