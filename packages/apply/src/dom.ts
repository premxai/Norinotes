/**
 * In-page scripts, kept as plain JS strings so transpilers (tsx/esbuild keepNames) cannot inject
 * helpers like __name that do not exist inside the browser. Each is a function expression that
 * is invoked with one JSON argument via `runScript`.
 */
import type { Page } from "playwright";

export async function runScript<T>(page: Page, script: string, arg: unknown = null): Promise<T> {
  return (await page.evaluate(`(${script})(${JSON.stringify(arg)})`)) as T;
}

/** Shared helpers, inlined into scripts that need them. */
const HELPERS = String.raw`
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function textOf(el) {
    var c = el.cloneNode(true);
    c.querySelectorAll('input,select,textarea,script,style,option,button').forEach(function (n) { n.remove(); });
    return clean(c.textContent);
  }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    if (r.right < 0 || r.bottom < -2000) return false;
    return true;
  }
  function cssStr(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function count(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return 0; } }
  function path(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node !== el && node.id && count('#' + CSS.escape(node.id)) === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        return parts.join(' > ');
      }
      var i = 1, s = node.previousElementSibling;
      while (s) { if (s.tagName === node.tagName) i++; s = s.previousElementSibling; }
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      node = node.parentElement;
    }
    parts.unshift('html');
    return parts.join(' > ');
  }
  function uniq(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) { var s1 = '#' + CSS.escape(el.id); if (count(s1) === 1) return s1; }
    var n = el.getAttribute('name');
    if (n) { var s2 = tag + '[name=' + cssStr(n) + ']'; if (count(s2) === 1) return s2; }
    return path(el);
  }
  function formRoot() { return document.querySelector('[data-norinote-form]') || document.body; }
`;

/** Pick the application form, tag it with data-norinote-form, and describe every field in it. Arg: preferred root selectors. */
export const DISCOVER_SCRIPT = String.raw`function (preferred) {
  ${HELPERS}
  var KEY = /application|apply|job/i;
  var FIELD_SEL = 'input:not([type=hidden]),textarea,select';
  function attrs(f) { return [f.id, f.getAttribute('name'), typeof f.className === 'string' ? f.className : '', f.getAttribute('aria-label')].join(' '); }
  function countFields(f) { return f.querySelectorAll(FIELD_SEL).length; }

  var root = null;
  (preferred || []).some(function (sel) {
    try { var el = document.querySelector(sel); if (el && countFields(el) > 0) { root = el; return true; } } catch (e) {}
    return false;
  });
  if (!root) {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form')).filter(function (f) { return countFields(f) > 0; });
    var keyed = forms.filter(function (f) { return KEY.test(attrs(f)); });
    var pool = keyed.length ? keyed : forms;
    pool.sort(function (a, b) { return countFields(b) - countFields(a); });
    root = pool[0] || document.body;
  }
  document.querySelectorAll('[data-norinote-form]').forEach(function (e) { e.removeAttribute('data-norinote-form'); });
  root.setAttribute('data-norinote-form', '1');

  function preceding(el) {
    var node = el;
    for (var depth = 0; node && node !== root && depth < 6; depth++) {
      var sib = node.previousElementSibling;
      while (sib) {
        if (!sib.matches('input,select,textarea,button,script,style')) {
          if (sib.querySelector(FIELD_SEL)) return '';
          var t = textOf(sib);
          if (t) return t.slice(0, 300);
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '';
  }
  function byIds(ids) {
    return clean(ids.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? textOf(n) : ''; }).join(' '));
  }
  // A for-less <label>/<legend> heading the field block that holds only this field (Greenhouse file uploads).
  function blockLabel(el) {
    var block = el.closest('.field, .form-group, .form-field, fieldset, li');
    if (!block || block === root || !root.contains(block)) return '';
    if (block.querySelectorAll(FIELD_SEL).length !== 1) return '';
    var head = block.querySelector('label:not([for]), legend, .label, .field-label');
    return head && !head.contains(el) ? textOf(head) : '';
  }
  function labelFor(el) {
    var t = '';
    if (el.labels) { for (var i = 0; i < el.labels.length && !t; i++) t = textOf(el.labels[i]); }
    if (!t && el.getAttribute('aria-label')) t = clean(el.getAttribute('aria-label'));
    if (!t && el.getAttribute('aria-labelledby')) t = byIds(el.getAttribute('aria-labelledby'));
    if (!t) t = blockLabel(el);
    if (!t && el.getAttribute('placeholder')) t = clean(el.getAttribute('placeholder'));
    if (!t) t = preceding(el);
    return t;
  }
  function groupLabel(container, first) {
    var t = '';
    if (container) {
      var legend = container.querySelector('legend');
      if (legend) t = textOf(legend);
      if (!t && container.getAttribute('aria-labelledby')) t = byIds(container.getAttribute('aria-labelledby'));
      if (!t && container.getAttribute('aria-label')) t = clean(container.getAttribute('aria-label'));
      if (!t) t = preceding(container);
    }
    if (!t) t = preceding(first);
    return t;
  }
  function optionLabel(el) {
    var t = '';
    if (el.labels) { for (var i = 0; i < el.labels.length && !t; i++) t = textOf(el.labels[i]); }
    if (!t && el.getAttribute('aria-label')) t = clean(el.getAttribute('aria-label'));
    if (!t && el.nextSibling) t = clean(el.nextSibling.textContent);
    return t || el.value || '';
  }
  function commonAncestor(els) {
    var a = els[0].parentElement;
    while (a && !els.every(function (e) { return a.contains(e); })) a = a.parentElement;
    return a;
  }
  function kindOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if ((el.getAttribute('role') || '').toLowerCase() === 'combobox') return 'select';
    var ty = (el.getAttribute('type') || 'text').toLowerCase();
    if (['text', 'search', 'url', 'number', 'date', 'month'].indexOf(ty) >= 0) return 'text';
    if (['email', 'tel', 'radio', 'checkbox', 'file'].indexOf(ty) >= 0) return ty;
    return 'unknown';
  }
  function isHoneypot(el) {
    var s = [el.id, el.getAttribute('name'), typeof el.className === 'string' ? el.className : ''].join(' ');
    return /honeypot|hp_field|do[-_]?not[-_]?fill/i.test(s);
  }
  function isPhoneInput(e) {
    if ((e.getAttribute('type') || '').toLowerCase() === 'tel') return true;
    return /phone/i.test([e.id, e.getAttribute('name'), e.getAttribute('autocomplete'), e.getAttribute('aria-label')].join(' '));
  }
  // A "Country" select/combobox sitting in (or right next to) the phone field's wrapper is the dialing-code picker.
  function isPhoneCountry(el, label) {
    if (!/^(country|country code|phone country( code)?|dialing code)$/i.test(clean(label.replace(/\*/g, '')))) return false;
    var node = el.parentElement;
    for (var depth = 0; node && node !== root.parentElement && depth < 4; depth++) {
      var inner = Array.prototype.slice.call(node.querySelectorAll(FIELD_SEL)).filter(function (e) { return e !== el; });
      if (inner.length > 4) break;
      if (inner.some(isPhoneInput)) return true;
      var sibs = [node.previousElementSibling, node.nextElementSibling];
      for (var k = 0; k < sibs.length; k++) {
        var sib = sibs[k];
        if (sib && (sib.matches('input') ? isPhoneInput(sib) : Array.prototype.slice.call(sib.querySelectorAll('input')).some(isPhoneInput))) return true;
      }
      node = node.parentElement;
    }
    return false;
  }
  function finish(raw, required, kind, options, selector) {
    var req = !!required || /\*/.test(raw);
    var out = { label: clean(String(raw || '').replace(/\*/g, '')), kind: kind, required: req, selector: selector };
    if (options) out.options = options;
    return out;
  }

  var fields = [];
  var seenGroups = {};
  Array.prototype.slice.call(root.querySelectorAll(FIELD_SEL)).forEach(function (el) {
    var ty = (el.getAttribute('type') || '').toLowerCase();
    if (['submit', 'button', 'reset', 'image', 'password'].indexOf(ty) >= 0) return;
    if (el.disabled || isHoneypot(el)) return;
    var kind = kindOf(el);
    if (kind === 'file') {
      // File inputs are routinely hidden behind an "Attach" button; keep them unless their whole field block is hidden.
      var wrapper = el.closest('.field, fieldset, li, .form-group');
      if (wrapper && wrapper !== root && !visible(wrapper)) return;
    } else if (kind === 'radio' || kind === 'checkbox') {
      var lab = el.labels && el.labels[0];
      if (!visible(el) && !(lab && visible(lab))) return;
    } else if (!visible(el) || el.closest('[aria-hidden="true"]')) {
      return;
    }

    if (kind === 'radio' || kind === 'checkbox') {
      var name = el.getAttribute('name');
      var group = name ? Array.prototype.slice.call(root.querySelectorAll('input[type=' + kind + '][name=' + cssStr(name) + ']')) : [el];
      if (kind === 'radio' || group.length > 1) {
        var gkey = kind + ':' + (name || uniq(el));
        if (seenGroups[gkey]) return;
        seenGroups[gkey] = true;
        var container = el.closest('fieldset,[role=radiogroup],[role=group]') || (group.length > 1 ? commonAncestor(group) : null);
        var required = group.some(function (g) { return g.required || g.getAttribute('aria-required') === 'true'; }) ||
          (!!container && container.getAttribute('aria-required') === 'true');
        var selector = name ? 'input[type="' + kind + '"][name=' + cssStr(name) + ']' : uniq(el);
        fields.push(finish(groupLabel(container, el), required, kind, group.map(optionLabel), selector));
        return;
      }
      fields.push(finish(labelFor(el), el.required || el.getAttribute('aria-required') === 'true', 'checkbox', ['Yes'], uniq(el)));
      return;
    }

    var options;
    var combo = kind === 'select' && el.tagName !== 'SELECT';
    if (kind === 'select' && !combo) {
      options = Array.prototype.slice.call(el.options).filter(function (o) { return o.value !== '' && !o.disabled; })
        .map(function (o) { return clean(o.textContent); });
    }
    var rawLabel = labelFor(el);
    var f = finish(rawLabel, el.required || el.getAttribute('aria-required') === 'true', kind, options, uniq(el));
    if (combo) f.combobox = true;
    if (kind === 'select' && isPhoneCountry(el, rawLabel)) { f.group = 'phone_country'; f.label = 'Phone country code'; }
    fields.push(f);
  });
  return fields;
}`;

/** Options of a select as { text, value }. Arg: selector. */
export const SELECT_OPTIONS_SCRIPT = String.raw`function (sel) {
  var el = document.querySelector(sel);
  if (!el || !el.options) return [];
  return Array.prototype.slice.call(el.options).map(function (o) { return { text: o.textContent.replace(/\s+/g, ' ').trim(), value: o.value }; });
}`;

/** Labels of every radio/checkbox matched by the selector. Arg: selector. */
export const CHOICE_LABELS_SCRIPT = String.raw`function (sel) {
  ${HELPERS}
  return Array.prototype.slice.call(document.querySelectorAll(sel)).map(function (el) {
    var t = '';
    if (el.labels) { for (var i = 0; i < el.labels.length && !t; i++) t = textOf(el.labels[i]); }
    if (!t && el.getAttribute('aria-label')) t = clean(el.getAttribute('aria-label'));
    if (!t && el.nextSibling) t = clean(el.nextSibling.textContent);
    return { label: t, value: el.value || '' };
  });
}`;

/** Set a value through the native setter and fire input/change, for React-controlled inputs. Arg: [selector, value]. */
export const FORCE_VALUE_SCRIPT = String.raw`function (arg) {
  var el = document.querySelector(arg[0]);
  if (!el) return false;
  var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, arg[1]); else el.value = arg[1];
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return el.value === arg[1];
}`;

/** Tag the best submit control with data-norinote-submit; returns its label or null. */
export const FIND_SUBMIT_SCRIPT = String.raw`function () {
  ${HELPERS}
  document.querySelectorAll('[data-norinote-submit]').forEach(function (e) { e.removeAttribute('data-norinote-submit'); });
  var root = formRoot();
  function candidates(scope) {
    return Array.prototype.slice.call(scope.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a.button, a.btn'))
      .filter(function (b) { return visible(b) && !b.disabled; });
  }
  function label(b) { return clean(b.tagName === 'INPUT' ? b.value : (b.textContent || b.getAttribute('aria-label') || '')); }
  // Step buttons of a multi-page form are often type=submit too. Clicking one is not sending the application.
  function stepLike(b) { return /^(next|continue|save|back|previous|prev|review|cancel|add|upload|attach|skip)\b/i.test(label(b)); }
  var scopes = root === document.body ? [document.body] : [root, document.body];
  var tests = [
    function (b) { return /submit\s+(my\s+|your\s+)?application/i.test(label(b)); },
    function (b) { return /^submit\b/i.test(label(b)); },
    // "Apply now" outside the form is the posting's link to the form, not a submit button.
    function (b) { return /^(apply|apply now|send application)$/i.test(label(b)) && (root === document.body || root.contains(b)); },
    function (b) { return (b.getAttribute('type') || '').toLowerCase() === 'submit' && root.contains(b); },
    function (b) { return /^(verify|confirm)\b/i.test(label(b)) && !document.querySelector('[data-norinote-form] input[type=password]'); }
  ];
  for (var t = 0; t < tests.length; t++) {
    for (var s = 0; s < scopes.length; s++) {
      var found = candidates(scopes[s]).filter(function (b) { return !stepLike(b) && tests[t](b); })[0];
      if (found) { found.setAttribute('data-norinote-submit', '1'); return label(found) || 'submit'; }
    }
  }
  return null;
}`;

/** CAPTCHA detection. Returns a reason string or null. */
export const CAPTCHA_SCRIPT = String.raw`function () {
  ${HELPERS}
  var frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
  for (var i = 0; i < frames.length; i++) {
    var src = frames[i].getAttribute('src') || '';
    if (!/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(src)) continue;
    // Invisible reCAPTCHA (score-only badge) is not a challenge the user has to solve.
    if (/size=invisible/i.test(src)) continue;
    if (!visible(frames[i])) continue;
    var r = frames[i].getBoundingClientRect();
    if (r.width < 20 || r.height < 20) continue;
    return 'iframe:' + src.slice(0, 120);
  }
  var text = (document.body && document.body.innerText) || '';
  if (/verify (that )?you('| a)re (a )?human/i.test(text)) return 'text:verify you are human';
  return null;
}`;

/** Smallest visible block that reads like a confirmation message, or null. */
export const CONFIRMATION_SCRIPT = String.raw`function () {
  ${HELPERS}
  var re = /thank you|thanks for applying|application (has been |was )?(submitted|received)/i;
  var best = null;
  Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,p,div,section,span,main')).forEach(function (el) {
    if (!visible(el)) return;
    var t = clean(el.innerText);
    if (!t || !re.test(t) || t.length > 1500) return;
    if (!best || t.length < best.length) best = t;
  });
  return best ? best.slice(0, 500) : null;
}`;

/** Page context for answer generation: title plus text outside the form. */
export const JOB_CONTEXT_SCRIPT = String.raw`function () {
  var c = document.body.cloneNode(true);
  c.querySelectorAll('[data-norinote-form],script,style,noscript,svg').forEach(function (n) { n.remove(); });
  var text = (c.textContent || '').replace(/\s+/g, ' ').trim();
  return (document.title + '\n' + text).slice(0, 4000);
}`;

/** Verification code inputs: tags them data-norinote-code=<index>; returns the count. */
export const CODE_INPUTS_SCRIPT = String.raw`function () {
  ${HELPERS}
  document.querySelectorAll('[data-norinote-code]').forEach(function (e) { e.removeAttribute('data-norinote-code'); });
  var inputs = Array.prototype.slice.call(document.querySelectorAll('input')).filter(function (el) {
    var ty = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'tel', 'number'].indexOf(ty) >= 0 && visible(el) && !el.value;
  });
  var coded = inputs.filter(function (el) {
    var s = [el.id, el.getAttribute('name'), el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' ');
    return /code|otp|one-time|verification|security/i.test(s);
  });
  if (!coded.length) coded = inputs.filter(function (el) { return el.getAttribute('maxlength') === '1'; });
  coded.forEach(function (el, i) { el.setAttribute('data-norinote-code', String(i)); });
  return coded.length;
}`;

/** Count visible validation errors inside the form. */
export const ERRORS_SCRIPT = String.raw`function () {
  ${HELPERS}
  var root = formRoot();
  if (!root.isConnected || !visible(root)) return 0;
  return Array.prototype.slice.call(root.querySelectorAll('.error, .field-error, [role=alert], [aria-invalid=true], .invalid-feedback'))
    .filter(function (e) { return visible(e) && (e.getAttribute('aria-invalid') === 'true' || clean(e.textContent)); }).length;
}`;

/** True if the page shows a password field (account creation / sign-in wall). */
export const PASSWORD_SCRIPT = String.raw`function () {
  ${HELPERS}
  return Array.prototype.slice.call(document.querySelectorAll('input[type=password]')).some(visible);
}`;

/** True if the tagged form root currently shows at least one visible field. */
export const FORM_VISIBLE_SCRIPT = String.raw`function (preferred) {
  ${HELPERS}
  var roots = [];
  (preferred || []).forEach(function (s) { try { var e = document.querySelector(s); if (e) roots.push(e); } catch (x) {} });
  if (!roots.length) roots = Array.prototype.slice.call(document.querySelectorAll('form'));
  return roots.some(function (r) {
    return Array.prototype.slice.call(r.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select')).some(visible);
  });
}`;

/** True when the field (by selector) shows aria-invalid or an error message in its field block. Arg: selector. */
export const FIELD_ERROR_SCRIPT = String.raw`function (sel) {
  ${HELPERS}
  var el = document.querySelector(sel);
  if (!el) return null;
  if (el.getAttribute('aria-invalid') === 'true') return 'aria-invalid';
  var block = el.closest('.field, .form-group, .form-field, fieldset, li') || el.parentElement;
  if (!block) return null;
  var errs = Array.prototype.slice.call(block.querySelectorAll('.error, .field-error, .invalid-feedback, [role=alert], [id*=error]'))
    .filter(function (e) { return visible(e) && clean(e.textContent); });
  if (errs.length) return clean(errs[0].textContent).slice(0, 200);
  var next = el.nextElementSibling;
  if (next && visible(next) && /please (enter|select)|required|invalid/i.test(clean(next.textContent))) return clean(next.textContent).slice(0, 200);
  return null;
}`;
