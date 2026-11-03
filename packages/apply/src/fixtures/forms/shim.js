/*
 * Replay shim for the saved application pages (test infrastructure, never shipped to a real site). The saved pages have
 * no scripts, so this file stands in for the widgets the real sites render with JavaScript:
 *   - react-select style comboboxes: a listbox of [role=option] items (options from window.__fixtureOptions, a country
 *     list for the phone picker, typed text for location autocompletes); a click shows the choice like react-select does;
 *   - Ashby yes/no buttons: the clicked one becomes active and the hidden checkbox follows;
 *   - file inputs: a filename chip in the field block;
 *   - submit: stubbed. The form is never sent anywhere; a click replaces it with a thank-you message and POSTs to /__submit
 *     on the local fixture server only.
 */
/* global window, document, fetch, HTMLInputElement */
(function () {
  var COUNTRIES = ["United States +1", "Canada +1", "United Kingdom +44", "India +91", "Germany +49", "France +33", "Australia +61", "Ireland +353"];
  var OPTIONS = window.__fixtureOptions || {};
  var menu = null;

  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
  function isLocation(input) {
    var entry = input.closest("[data-field-path]");
    return /candidate-location|location/i.test((input.id || "") + " " + (input.name || "")) ||
      (entry && /location/i.test(entry.getAttribute("data-field-path") || ""));
  }
  function optionsFor(input) {
    if (OPTIONS[input.id]) return OPTIONS[input.id];
    if (input.name && OPTIONS[input.name]) return OPTIONS[input.name];
    if (input.id === "country" || /country/i.test(input.getAttribute("aria-label") || "")) return COUNTRIES;
    if (isLocation(input)) {
      var typed = clean(input.value);
      return typed.length >= 2 ? [typed.split(",")[0] + ", California, United States", typed.split(",")[0] + ", United States"] : [];
    }
    var entry = input.closest("[data-field-path]");
    if (entry && OPTIONS[entry.getAttribute("data-field-path")]) return OPTIONS[entry.getAttribute("data-field-path")];
    return ["Yes", "No"];
  }
  function close() { if (menu) menu.remove(); menu = null; }
  function show(input) {
    close();
    var typed = isLocation(input) ? "" : clean(input.value).toLowerCase();
    var opts = optionsFor(input).filter(function (o) { return !typed || o.toLowerCase().indexOf(typed) >= 0; });
    menu = document.createElement("div");
    menu.setAttribute("role", "listbox");
    menu.className = "select__menu shim-menu";
    menu.style.cssText = "position:relative;background:#fff;border:1px solid #888;z-index:9999;max-height:240px;overflow:auto";
    opts.forEach(function (o) {
      var d = document.createElement("div");
      d.setAttribute("role", "option");
      d.className = "select__option";
      d.textContent = o;
      d.style.cssText = "padding:4px;cursor:pointer";
      d.addEventListener("mousedown", function (e) { e.preventDefault(); });
      d.addEventListener("click", function () { choose(input, o); });
      menu.appendChild(d);
    });
    var anchor = input.closest(".select__control, .select-shell, [class*=inputContainer], .application-field, div") || input.parentElement;
    anchor.parentElement.insertBefore(menu, anchor.nextSibling);
  }
  function choose(input, text) {
    if (isLocation(input) && !input.closest(".select__container")) {
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, text);
    } else {
      var container = input.closest(".select__value-container") || input.parentElement;
      var multi = input.closest(".select") && OPTIONS["__multi__" + input.id];
      if (!multi) container.querySelectorAll(".select__single-value, .select__placeholder").forEach(function (n) { n.remove(); });
      var v = document.createElement("div");
      v.className = multi ? "select__multi-value" : "select__single-value";
      v.textContent = text;
      container.insertBefore(v, container.firstChild);
      input.value = "";
    }
    input.setAttribute("aria-invalid", "false");
    close();
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("input[role=combobox]")) { show(t); return; }
    if (menu && !menu.contains(t)) close();
    var btn = t && t.closest ? t.closest("[data-field-path] button") : null;
    if (btn && /^(yes|no)$/i.test(clean(btn.textContent))) {
      e.preventDefault();
      var entry = btn.closest("[data-field-path]");
      entry.querySelectorAll("button").forEach(function (b) { b.classList.remove("_active_shim"); });
      btn.classList.add("_active_shim");
      var box = entry.querySelector("input[type=checkbox]");
      if (box) box.checked = /^yes$/i.test(clean(btn.textContent));
      return;
    }
    var submit = t && t.closest ? t.closest("button, input[type=submit]") : null;
    if (submit && /submit/i.test(clean(submit.textContent || submit.value))) {
      e.preventDefault();
      fetch("/__submit", { method: "POST", body: "{}" }).then(function () {
        var form = document.querySelector("[data-norinote-form]") || document.querySelector("form");
        var done = document.createElement("div");
        done.innerHTML = "<h2>Thank you for applying.</h2><p>Your application has been submitted.</p>";
        if (form) form.replaceWith(done); else document.body.appendChild(done);
      });
    }
  }, true);
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.matches && t.matches("input[role=combobox]")) show(t);
    else if (t && t.matches && t.matches("input") && isLocation(t) && t.type === "text") show(t);
  }, true);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); }, true);
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || t.type !== "file" || !t.files || !t.files.length) return;
    var block = t.closest("[data-field-path], .field-wrapper, .application-question, li, .field, div") || t.parentElement;
    var chip = block.querySelector(".shim-file") || document.createElement("span");
    chip.className = "shim-file";
    chip.textContent = t.files[0].name;
    block.appendChild(chip);
  }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);
})();
