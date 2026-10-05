/* Lotta live-site wiring: cookieless analytics (PostHog, EU cloud) and form delivery (Brevo beta
   waitlist, Brevo newsletter). Loaded by the page with <script src="site.js" defer>.
   No build step, no dependencies. The page shows its own thank-you state; it only calls
   window.lottaSend(kind, data) after its own validation has passed. */
(function () {
  'use strict';

  /* ================= CONFIG: the only part that should ever need editing ================= */
  var CONFIG = {
    POSTHOG_KEY: 'phc_mzn7igvBjRujahJGEyyWiRW2bsRtmFdNre6uMXPXneau',                             // project token, starts with phc_ — Margarida will supply
    POSTHOG_HOST: 'https://eu.i.posthog.com',    // EU cloud
    BREVO_FORM_URL: 'https://9417a05b.sibforms.com/serve/MUIFAGuHn1DqJ3h-Myv-GfecIRgSws_YhJJXLSUVJiyT4WGLNfcWzW7mbD6waLOZU9y1exKqHTWIMO0RwbAHtnwdyCEw1Tp5YY0PMzmv2HSZbn7S960eaPqphIMdUsTBLxEW_r9c5MhxxzdoyfQb7lZwmyZhU1oFTzGjn4Vn280PUrlpBJZe6EewvA_trl2ri8mM8DC8AW37qT38-g==',                          // Brevo subscription form action URL (…sibforms.com/serve/…) — supplied once she creates the form
    NEWSLETTER_FORM_URL: 'https://9417a05b.sibforms.com/serve/MUIFACu9f64gIC9RUNhUJQCoELJAsXLeWhCB6xlYKK3KmXoMcIZJz3kRQjWmqPv7VUoSCRJX6k6XsgS5Koq5WS2TdzFnplyy5tRwbhnyjqDwqrHMXkqhxVUfUYWcEji07hYHCP0X25xrxYPJ70dBf9q80jiJiFKYOJh5q2KxN9ARpSAXppf5rumLzXHRHpxjiEw_1GU0UB8KoEMaDg==', // Brevo form "Lotta newsletter" -> list Newsletter (30 Sep: no Substack; the blog lives on the site)
    SEND_STAGE: true,                            // on since 1 Oct 2026. Until 5 Oct the pop-up had Filipa's two required boxes (one just for the GLP-1 answer, which is health data); from 5 Oct one required box covers the whole form, GLP-1 answer included (Margarida's wording). Brevo field JOURNEY_STAGE

    // Brevo contact attribute names exactly as they appear in the form's HTML embed code (name="…").
    // EMAIL and FIRSTNAME are Brevo defaults in an English-language account; COUNTRY and JOURNEY_STAGE are
    // custom attributes we ask her to create as TEXT type. Check against the embed code when it arrives.
    BREVO_FIELDS: { email: 'EMAIL', firstName: 'FIRSTNAME', country: 'COUNTRY', stage: 'JOURNEY_STAGE', source: 'SOURCE' },

    _END: true
  };
  /* ======================================================================================== */

  var host = location.hostname;
  var isLive = host === 'lotta.health' || host === 'www.lotta.health';
  var isDev = host === 'localhost' || host === '127.0.0.1';
  if (!isLive && !isDev) return; // anywhere else (claude.ai preview, file://, other domains): do nothing at all

  /* Test-only override. On localhost / 127.0.0.1 only, a test harness may define
     window.LOTTA_TEST_CONFIG = { POSTHOG_KEY: 'phc_…', BREVO_FORM_URL: '…', … } before this file runs;
     its keys replace the CONFIG values above. Ignored on the live domain. */
  /* Local runs are dry by default: nothing reaches Brevo or PostHog unless the address says
     ?live-test (a deliberate real test) or a test harness passes LOTTA_TEST_CONFIG. Added 30 Sep 2026
     after a local walk-through sent a made-up sign-up to the real Brevo form. */
  if (isDev && !/[?&]live-test\b/.test(location.search)) { CONFIG.POSTHOG_KEY = ''; CONFIG.BREVO_FORM_URL = ''; CONFIG.NEWSLETTER_FORM_URL = ''; }
  if (isDev && window.LOTTA_TEST_CONFIG && typeof window.LOTTA_TEST_CONFIG === 'object') {
    for (var k in window.LOTTA_TEST_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(CONFIG, k)) CONFIG[k] = window.LOTTA_TEST_CONFIG[k];
    }
  }

  function note(msg) { try { console.info('[lotta] ' + msg); } catch (_) {} }
  function warn(msg, err) { try { console.warn('[lotta] ' + msg, err || ''); } catch (_) {} }

  /* ---------------- 1. PostHog analytics, cookieless ----------------
     Docs checked 29 Sep 2026:
       snippet + defaults ........ https://posthog.com/docs/libraries/js (copied verbatim below)
       cookieless_mode 'always' .. https://posthog.com/tutorials/cookieless-tracking — "never stores data in cookies
                                   or local/session storage"; needs "Cookieless server hash mode" switched on in
                                   Project settings > Web analytics, otherwise PostHog ignores these events.
       person_profiles 'never' ... turns identify() into a no-op (same tutorial). We never call identify() anyway.
       options ................... https://posthog.com/docs/libraries/js/config
     Privacy: autocapture does not send form values, but it does send the visible text of what was clicked
     (for example a journey-stage chip, "On treatment"). So the two forms and their thank-you panels are
     excluded from autocapture, dead-click and rage-click capture. Custom events carry only fixed page text. */
  var phOn = false;
  var PRIVATE_AREAS = ['#bq', '#beta-form', '#bf-thanks', '#nl-form', '#nl-thanks'];
  var PRIVATE_SEL = [];
  PRIVATE_AREAS.forEach(function (s) { PRIVATE_SEL.push(s, s + ' *'); });

  if (CONFIG.POSTHOG_KEY) {
    if (!/^phc_/.test(CONFIG.POSTHOG_KEY)) {
      // A personal API key (phx_…) would be public in this file: refuse anything that is not a project token.
      warn('POSTHOG_KEY must be the project token (starts with phc_). Analytics is off.');
    } else {
      try {
        /* Official PostHog snippet, verbatim from https://posthog.com/docs/libraries/js (29 Sep 2026). It loads
           array.js from the matching assets host: https://eu.i.posthog.com -> https://eu-assets.i.posthog.com */
        !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

        window.posthog.init(CONFIG.POSTHOG_KEY, {
          api_host: CONFIG.POSTHOG_HOST,
          defaults: '2026-05-30',            // as in the official snippet: pageviews + autocapture on
          cookieless_mode: 'always',         // no cookies, no localStorage, no sessionStorage; no banner needed
          person_profiles: 'never',          // no person profiles; identify() becomes a no-op
          disable_session_recording: true,   // no session replay, ever
          disable_surveys: true,             // surveys need browser storage; not used
          autocapture: { css_selector_ignorelist: ['.ph-no-autocapture', '[data-ph-no-autocapture]'].concat(PRIVATE_SEL) },
          capture_dead_clicks: { css_selector_ignorelist: ['.ph-no-deadclick', '.ph-no-capture', '[data-no-dead-clicks]'].concat(PRIVATE_SEL) },
          rageclick: { css_selector_ignorelist: ['.ph-no-rageclick'].concat(PRIVATE_SEL) }
        });
        phOn = true;
      } catch (err) { warn('analytics did not start', err); }
    }
  }

  // Send one custom event. Property values are fixed page text only, never anything a visitor typed.
  function track(name, props) {
    if (!phOn) return;
    try { window.posthog.capture(name, props || {}); } catch (_) {}
  }
  function label(el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
  function place(el) {
    if (el.closest('#sheet')) return 'menu';
    if (el.closest('.nav')) return 'nav';
    var s = el.closest('section[id]');
    return s ? (s.id === 'top' ? 'hero' : s.id) : '';
  }
  function postTitle(el) {
    var card = el.closest('.post-card');
    return label(card && (card.querySelector('.post-t') || card.querySelector('.post-link')));
  }

  /* Delegated clicks, in the capture phase: the page's Share handler stops propagation, so a normal
     (bubbling) listener would never see Share clicks. Capture phase also runs before the FAQ handler,
     so aria-expanded still shows the state before the click. */
  if (phOn) {
    document.addEventListener('click', function (e) {
      var t = e.target, el;
      if (!t || !t.closest) return;
      if ((el = t.closest('.share'))) { track('share_click', { title: postTitle(el) }); return; }
      if ((el = t.closest('.post-link'))) { track('blog_post_click', { title: label(el) }); return; }
      if ((el = t.closest('.faq-q'))) {
        if (el.getAttribute('aria-expanded') !== 'true') track('faq_open', { question: label(el) });
        return;
      }
      if ((el = t.closest('.nav-links a, .sheet-links a'))) { track('nav_click', { label: label(el), place: place(el) }); return; }
      if ((el = t.closest('.btn'))) {
        if (el.closest('form')) return; // Subscribe / Join-the-beta submit buttons: counted by the sign-up events
        track('cta_click', { label: label(el), place: place(el) });
      }
    }, true);
  }

  /* ---------------- 2. Form delivery ---------------- */

  /* Beta waitlist -> Brevo hosted sign-up form endpoint.
     Field names CONFIRMED on 29 Sep 2026 from the HTML of two live, public Brevo forms
     (…sibforms.com/serve/MUIEAMa9… and …/serve/MUIFAKrb…) and Brevo's own form script
     (https://sibforms.com/forms/end-form/build/main.js):
       EMAIL, FIRSTNAME ...... inputs named after the contact attribute (Brevo default attributes,
                               https://help.brevo.com/hc/en-us/articles/10582214160274)
       OPT_IN=1 .............. the GDPR checkbox, present when "Enable GDPR fields" is on
       email_address_check ... honeypot, must be sent empty
       locale ................ hidden field, "en"
     Inferred, not observed on a live form: a custom TEXT attribute (COUNTRY) is posted under its attribute
     name, the same way FIRSTNAME is. Brevo's docs say a CATEGORY attribute stores a number for each value,
     so COUNTRY must be created as TEXT for the country's name to be accepted. Check both against the HTML
     embed code of her form when it arrives, and adjust BREVO_FIELDS if the names differ.
     Brevo's own script posts to "<action>?isAjax=1"; we do the same. Its no-JavaScript form posts
     urlencoded (the form has no enctype), which is what we send. CORS: sibforms.com currently echoes the
     page's Origin, so a readable request would also work, but no-cors does not depend on that. */
  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // same check the page uses before calling lottaSend

  /* The channel a sign-up came from: the utm_source label of a link we shared (e.g. ?utm_source=instagram),
     read from the address of the page the visitor is on. Nothing is saved on the device (privacy policy, section 18). */
  function channel() {
    var m = /[?&]utm_source=([^&#]*)/i.exec(location.search || '');
    if (!m) return '';
    var v = ''; try { v = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { v = m[1]; }
    return v.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function sendBeta(d) {
    if (!EMAIL_OK.test(String(d.email || '').trim())) return Promise.resolve('invalid');
    var url = String(CONFIG.BREVO_FORM_URL || '').trim();
    if (!url) {
      track('beta_signup');
      note('preview mode: BREVO_FORM_URL is empty, so the beta sign-up was not sent anywhere.');
      return Promise.resolve('preview');
    }
    var f = CONFIG.BREVO_FIELDS;
    var body = new URLSearchParams();
    body.append(f.email, d.email || '');
    body.append(f.firstName, d.firstName || '');
    if (d.country) body.append(f.country, d.country);
    if (CONFIG.SEND_STAGE === true && d.stage) body.append(f.stage, d.stage);
    var src = channel(); if (src && f.source) body.append(f.source, src);
    body.append('OPT_IN', '1');               // the page only calls lottaSend after its consent box is ticked
    body.append('email_address_check', '');   // Brevo honeypot: always empty from a real person
    body.append('locale', 'en');
    if (!/[?&]isAjax=/.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 'isAjax=1';
    var sent = fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true, body: body })
      .then(function () { return 'sent'; }, function (err) { warn('beta sign-up could not reach Brevo', err); return 'error'; });
    track('beta_signup');
    return sent;
  }

  /* Newsletter -> Brevo form "Lotta newsletter" (list Newsletter, one welcome email). Same method as the beta form. */
  function sendNewsletter(d) {
    if (!EMAIL_OK.test(String(d.email || '').trim())) return Promise.resolve('invalid');
    track('newsletter_signup');
    var url = String(CONFIG.NEWSLETTER_FORM_URL || '').trim();
    if (!url) {
      note('preview mode: NEWSLETTER_FORM_URL is empty, so the newsletter sign-up was not sent anywhere.');
      return Promise.resolve('preview');
    }
    var body = new URLSearchParams();
    body.append('EMAIL', d.email || '');
    body.append('email_address_check', '');   // Brevo honeypot: always empty from a real person
    body.append('locale', 'en');
    if (!/[?&]isAjax=/.test(url)) url += (url.indexOf('?') === -1 ? '?' : '&') + 'isAjax=1';
    return fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', keepalive: true, body: body })
      .then(function () { return 'sent'; }, function (err) { warn('newsletter sign-up could not reach Brevo', err); return 'error'; });
  }


  /* window.lottaSend(kind, data): always returns a Promise, never throws, never rejects.
     Resolves 'sent' | 'opened' | 'preview' | 'invalid' | 'error' | 'ignored'. */
  window.lottaSend = function (kind, data) {
    try {
      data = data || {};
      var p = kind === 'beta' ? sendBeta(data) : kind === 'newsletter' ? sendNewsletter(data) : Promise.resolve('ignored');
      return Promise.resolve(p).then(null, function (err) { warn('send failed', err); return 'error'; });
    } catch (err) {
      warn('send failed', err);
      try { return Promise.resolve('error'); } catch (_) { return undefined; }
    }
  };
})();
