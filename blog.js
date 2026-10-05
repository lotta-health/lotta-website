/* Lotta blog: how the articles are drawn on the blog page (the big cover, the tiles beside it, the cards under "Latest").
   Used twice, so the two can never drift apart:
     1. by build-blog.mjs, to write blog/index.html from the articles published in Ghost;
     2. in the browser, to re-draw the page when a visitor picks a topic.
   Layout chosen on 5 Oct 2026: the cover and tiles of "Cover story", under the title and topic buttons of "Filter and grid". */
(function (root) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* a title or line of text; "GLP-1" never breaks across two lines */
  function txt(s) { return esc(s).replace(/GLP-1s?/g, '<span class="nw">$&</span>'); }
  /* the picture: a small and a large file where the builder made both, so phones fetch the small one; only the cover loads at once */
  function pic(p, sizes, first) {
    if (!p.img) return '';
    return '<img class="bl-img" src="' + esc(p.img) + '"' + (p.srcset ? ' srcset="' + esc(p.srcset) + '" sizes="' + sizes + '"' : '') + ' alt=""' +
      (first ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"' + (p.pos ? ' style="object-position:' + esc(p.pos) + '"' : '') + '>';
  }
  function go(p) { return '<a class="bl-go" href="' + esc(p.href) + '">' + txt(p.title) + '</a>'; }
  /* the round ">" on the highlighted articles (the cover and the tiles beside it); it slides forward when the card is pointed at (pages.css) */
  var ARROW = '<span class="bl-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

  function cover(p) {
    return '<article class="bl-ph bl-cover">' + pic(p, '(min-width:1000px) 66vw, 100vw', true) + '<div class="bl-in"><p class="bl-meta">' +
      (p.isNew ? '<span class="bl-new">New</span>' : p.tag ? '<span class="bl-new">' + esc(p.tag) + '</span>' : '') + esc(p.read) + '</p>' +
      '<h2 class="bl-t">' + go(p) + '</h2>' + (p.excerpt ? '<p class="bl-hook">' + txt(p.excerpt) + '</p>' : '') + '</div>' + ARROW + '</article>';
  }
  function tile(p) { return '<article class="bl-ph bl-tile">' + pic(p, '(min-width:1000px) 33vw, 100vw') + '<div class="bl-in"><h3 class="bl-t">' + go(p) + '</h3></div>' + ARROW + '</article>'; }
  function card(p) {
    return '<li class="bl-card"><div class="bl-pic">' + pic(p, '(min-width:1000px) 33vw, (min-width:700px) 50vw, 100vw') + '</div><p class="bl-cmeta">' + (p.tag ? '<b>' + esc(p.tag) + '</b> · ' : '') + esc(p.date) + '</p>' +
      '<h3 class="bl-ct">' + go(p) + '</h3>' + (p.excerpt ? '<p class="bl-chook">' + txt(p.excerpt) + '</p>' : '') + '</li>';
  }
  /* newest article = the cover; the next three = the tiles beside it; everything older = cards under "Latest" */
  function main(posts) {
    if (!posts.length) return '';
    var tiles = posts.slice(1, 4), rest = posts.slice(4);
    return '<div class="bl-mosaic' + (tiles.length ? '' : ' bl-one') + '">' + cover(posts[0]) + (tiles.length ? '<div class="bl-tiles">' + tiles.map(tile).join('') + '</div>' : '') + '</div>' +
      (rest.length ? '<section class="bl-latest" aria-labelledby="bl-latest-h"><h2 class="bl-h" id="bl-latest-h">Latest</h2><ul class="bl-grid">' + rest.map(card).join('') + '</ul></section>' : '');
  }
  function cards(posts) { return posts.map(card).join(''); }

  root.LottaBlog = { main: main, cards: cards, pic: pic, esc: esc, txt: txt };

  /* in the browser: the topic buttons */
  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', function () {
    var data = document.getElementById('bl-data'), box = document.getElementById('bl-main'), pills = document.querySelector('.bl-pills');
    if (!data || !box || !pills) return;
    var posts; try { posts = JSON.parse(data.textContent); } catch (e) { return; }
    pills.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tag]'); if (!b) return;
      var tag = b.getAttribute('data-tag');
      [].slice.call(pills.querySelectorAll('button[data-tag]')).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      box.innerHTML = main(tag ? posts.filter(function (p) { return p.tags.indexOf(tag) >= 0; }) : posts);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
