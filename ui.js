// Marks Helper Pro — panel, check screen and verification on Fedena's Mark Entry page.
(function () {
  'use strict';
  var MHP = window.MHP;
  if (!MHP || document.getElementById('mhp-panel')) return;
  if (!MHP.pageStudents().length) return; // not a mark entry page with students

  var ctx = MHP.pageContext();
  var cols = MHP.pageColumns();
  var students = MHP.pageStudents();
  var STORE_KEY = 'mhp-pending:' + location.pathname + location.search;
  var KEEP_MS = 14 * 24 * 3600 * 1000;

  // ---------- storage (chrome.storage when available) ----------
  var store = {
    get: function (k, cb) {
      try { if (window.chrome && chrome.storage && chrome.storage.local) { chrome.storage.local.get(k, function (r) { cb(r ? r[k] : null); }); return; } } catch (e) {}
      try { cb(JSON.parse(localStorage.getItem(k) || 'null')); } catch (e) { cb(null); }
    },
    set: function (k, v) {
      try { if (window.chrome && chrome.storage && chrome.storage.local) { var o = {}; o[k] = v; chrome.storage.local.set(o); return; } } catch (e) {}
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { if (window.chrome && chrome.storage && chrome.storage.local) { chrome.storage.local.remove(k); return; } } catch (e) {}
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (!attrs.hasOwnProperty(k)) continue;
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i] != null) el.appendChild(typeof kids[i] === 'string' ? document.createTextNode(kids[i]) : kids[i]);
    return el;
  }
  function download(name, content, type) {
    var blob = new Blob(['﻿' + content], { type: type || 'text/csv;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function safeName(s) { return String(s || '').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); }
  function stamp() { var d = new Date(); return d.toISOString().slice(0, 16).replace('T', ' '); }
  var ICON = (window.chrome && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('icons/icon-32.png') : '';

  // ---------- panel ----------
  var status = h('div', { class: 'mhp-status', 'aria-live': 'polite' });
  var fileInput = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.tsv,.txt,.json', class: 'mhp-hidden', id: 'mhp-file' });
  var drop = h('div', { class: 'mhp-drop', tabindex: '0', role: 'button', 'aria-label': 'Choose or drop a marks file' }, [
    h('b', { text: 'Drop your marks file here' }),
    h('span', { text: 'CA tracker (.xlsx), CSV or JSON · or click to choose' })
  ]);
  var verifyCard = h('div', { class: 'mhp-verify', hidden: 'hidden' });
  var body = h('div', { class: 'mhp-body' }, [
    h('div', { class: 'mhp-ctx' }, [
      h('b', { text: (ctx.subject || 'Subject') + ' · ' + (ctx.batch || 'Batch') }),
      h('span', { text: (ctx.exam ? ctx.exam + ' · ' : '') + students.length + ' students' }),
      h('span', { class: 'mhp-cols', text: cols.map(function (c) { return c.name + ' /' + c.max; }).join('  ·  ') })
    ]),
    verifyCard,
    drop, fileInput,
    h('div', { class: 'mhp-row' }, [
      h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Paste a table', onclick: openPaste }),
      h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Template (CSV)', onclick: function () {
        download('marks-template_' + safeName(ctx.subject) + '_' + safeName(ctx.batch) + '.csv', MHP.templateCsv());
        say('Template downloaded: every student on this page, with one column per mark.');
      } })
    ]),
    h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Verify this page now', onclick: function () { runVerify(true); } }),
    status
  ]);
  var locked = MHP.analyse(document, []).counts.locked;
  var panel = h('section', { id: 'mhp-panel', 'aria-label': 'Marks Helper Pro' }, [
    h('header', { class: 'mhp-head' }, [
      ICON ? h('img', { src: ICON, alt: '', width: '20', height: '20' }) : null,
      h('span', { text: 'Marks Helper Pro' }),
      h('button', { class: 'mhp-min', type: 'button', 'aria-label': 'Minimise', text: '–', onclick: function () {
        panel.classList.toggle('mhp-collapsed'); this.textContent = panel.classList.contains('mhp-collapsed') ? '+' : '–';
      } })
    ]),
    body
  ]);
  document.body.appendChild(panel);

  function say(msg, kind) { status.textContent = msg; status.className = 'mhp-status' + (kind ? ' mhp-' + kind : ''); }
  if (locked === students.length) say('These marks are locked (already submitted). You can still verify them against a file.', 'warn');
  else say('Ready. Drop the class marks file to check it before anything is filled.');

  // ---------- reading files ----------
  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('mhp-over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('mhp-over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', function () { if (fileInput.files[0]) readFile(fileInput.files[0]); fileInput.value = ''; });

  function readFile(file) {
    var isBook = /\.(xlsx|xls)$/i.test(file.name);
    var reader = new FileReader();
    reader.onerror = function () { say('Could not read "' + file.name + '".', 'bad'); };
    reader.onload = function () {
      try {
        var tables = isBook ? MHP.tablesFromWorkbook(window.XLSX, new Uint8Array(reader.result)) : MHP.tablesFromText(reader.result);
        openCheck(tables, file.name);
      } catch (e) { say('Could not read "' + file.name + '": ' + e.message, 'bad'); }
    };
    if (isBook) reader.readAsArrayBuffer(file); else reader.readAsText(file, 'utf-8');
  }

  function openPaste() {
    var ta = h('textarea', { class: 'mhp-paste', id: 'mhp-paste', placeholder: 'Paste rows copied from Excel or Google Sheets (with the heading row), a CSV, or the JSON file.' });
    var m = modal('Paste marks', [
      h('p', { class: 'mhp-muted', text: 'Include the heading row (e.g. Admission No. · Student Name · HW · Oral · Cw · Attnd). Students are matched by admission number, then by name.' }),
      ta
    ], [
      h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Cancel', onclick: function () { m.close(); } }),
      h('button', { class: 'mhp-btn', type: 'button', text: 'Check marks', onclick: function () {
        try { var t = MHP.tablesFromText(ta.value); m.close(); openCheck(t, 'pasted table'); }
        catch (e) { ta.setCustomValidity(''); alertIn(m, 'Could not read the pasted text: ' + e.message); }
      } })
    ]);
    ta.focus();
  }

  // ---------- modal ----------
  function modal(title, content, actions, wide) {
    var prevFocus = document.activeElement;
    var box = h('div', { class: 'mhp-box' + (wide ? ' mhp-wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div', { class: 'mhp-box-head' }, [h('h2', { text: title }), h('button', { class: 'mhp-x', type: 'button', 'aria-label': 'Close', text: '×', onclick: function () { api.close(); } })]),
      h('div', { class: 'mhp-box-body' }, content),
      h('div', { class: 'mhp-box-foot' }, actions)
    ]);
    var wrap = h('div', { class: 'mhp-modal' }, [box]);
    function onKey(e) { if (e.key === 'Escape') api.close(); }
    var api = {
      el: box,
      close: function () { wrap.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    return api;
  }
  function alertIn(m, msg) {
    var old = m.el.querySelector('.mhp-inline-error');
    if (old) old.remove();
    m.el.querySelector('.mhp-box-body').appendChild(h('p', { class: 'mhp-inline-error', role: 'alert', text: msg }));
  }

  // ---------- the check screen ----------
  var STATUS = {
    ready: ['Ready', 'ok'], partial: ['Missing marks', 'warn'], invalid: ['Invalid mark', 'bad'],
    none: ['No marks in file', 'bad'], locked: ['Locked', 'muted']
  };

  function openCheck(tables, sourceName) {
    var sheets = MHP.analyseSheets(tables, cols);
    var state = { sheet: sheets[0] || null, map: null, unknownCols: [], filter: 'attention' };
    if (!tables.json && !state.sheet) { say('No table was found in "' + sourceName + '".', 'bad'); return; }
    if (state.sheet) state.map = { headerRow: state.sheet.headerRow, name: state.sheet.found.name, adm: state.sheet.found.adm, cols: copyCols(state.sheet.found.cols) };

    var content = h('div', { class: 'mhp-check' });
    var fillReady = h('button', { class: 'mhp-btn', type: 'button' });
    var fillValid = h('button', { class: 'mhp-btn mhp-ghost', type: 'button' });
    var m = modal('Check before filling · ' + sourceName, [content], [
      h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Cancel', onclick: function () { m.close(); } }),
      fillValid, fillReady
    ], true);

    function copyCols(o) { var r = {}; for (var k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }

    function records() {
      if (tables.json) {
        var res = MHP.recordsFromJson(tables.json, cols);
        state.unknownCols = res.unknownCols;
        return res.records;
      }
      return MHP.recordsFromSheet(tables.sheets[state.sheet.index], state.map);
    }

    function render() {
      var report = MHP.analyse(document, records());
      state.report = report;
      content.innerHTML = '';

      // mapping (spreadsheets only)
      if (!tables.json) {
        var sheetSel = h('select', { id: 'mhp-sheet' });
        for (var s = 0; s < sheets.length; s++) {
          var o = h('option', { value: String(s), text: sheets[s].name });
          if (sheets[s] === state.sheet) o.selected = true;
          sheetSel.appendChild(o);
        }
        sheetSel.addEventListener('change', function () {
          state.sheet = sheets[+sheetSel.value];
          state.map = { headerRow: state.sheet.headerRow, name: state.sheet.found.name, adm: state.sheet.found.adm, cols: copyCols(state.sheet.found.cols) };
          render();
        });
        var mapRow = h('div', { class: 'mhp-map' }, [h('label', { for: 'mhp-sheet' }, ['Sheet', sheetSel])]);
        function colSelect(label, current, onPick, id) {
          var sel = h('select', { id: id });
          sel.appendChild(h('option', { value: '-1', text: '— not in file —' }));
          var hs = state.sheet.headers;
          for (var i = 0; i < hs.length; i++) {
            if (!hs[i].label) continue;
            var op = h('option', { value: String(hs[i].index), text: hs[i].label });
            if (hs[i].index === current) op.selected = true;
            sel.appendChild(op);
          }
          sel.addEventListener('change', function () { onPick(+sel.value); render(); });
          var lab = h('label', { for: id, class: current < 0 ? 'mhp-unmapped' : '' }, [label, sel]);
          return lab;
        }
        mapRow.appendChild(colSelect('Admission No.', state.map.adm, function (v) { state.map.adm = v; }, 'mhp-map-adm'));
        mapRow.appendChild(colSelect('Name', state.map.name, function (v) { state.map.name = v; }, 'mhp-map-name'));
        for (var c = 0; c < cols.length; c++) (function (col) {
          var cur = state.map.cols[col.id] === undefined ? -1 : state.map.cols[col.id];
          mapRow.appendChild(colSelect(col.name + ' /' + col.max, cur, function (v) { state.map.cols[col.id] = v; }, 'mhp-map-' + col.id));
        })(cols[c]);
        content.appendChild(h('p', { class: 'mhp-muted', text: 'Columns were matched by their headings. Change any that are wrong; a red label means that mark was not found in the file.' }));
        content.appendChild(mapRow);
      } else if (state.unknownCols.length) {
        content.appendChild(h('p', { class: 'mhp-inline-error', text: 'Columns in the file that are not on this page (ignored): ' + state.unknownCols.join(', ') }));
      }

      // summary
      var c = report.counts;
      var chips = h('div', { class: 'mhp-chips' }, [
        chip(c.ready, 'ready', 'ok'), chip(c.partial, 'missing marks', 'warn'), chip(c.invalid, 'invalid', 'bad'),
        chip(c.none, 'no marks in file', 'bad'), c.locked ? chip(c.locked, 'locked', 'muted') : null,
        report.unknown.length ? chip(report.unknown.length, 'in file, not in this class', 'bad') : null,
        report.duplicates.length ? chip(report.duplicates.length, 'duplicate rows', 'warn') : null
      ]);
      content.appendChild(chips);

      // filter
      var tabs = h('div', { class: 'mhp-tabs', role: 'tablist' }, [
        tab('attention', 'Needs attention (' + (c.partial + c.invalid + c.none) + ')'),
        tab('all', 'All students (' + report.total + ')')
      ]);
      content.appendChild(tabs);

      // table
      var thead = h('tr', null, [h('th', { text: 'Student' }), h('th', { text: 'Adm. No.' }), h('th', { text: 'Status' })]);
      for (var k = 0; k < cols.length; k++) thead.appendChild(h('th', { class: 'mhp-num', text: cols[k].name + ' /' + cols[k].max }));
      var tbody = h('tbody');
      var shown = 0;
      for (var r = 0; r < report.rows.length; r++) {
        var row = report.rows[r];
        if (state.filter === 'attention' && (row.status === 'ready' || row.status === 'locked')) continue;
        shown++;
        var st = STATUS[row.status];
        var tr = h('tr', null, [
          h('td', { class: 'mhp-name', title: row.how ? 'Matched by ' + row.how + (row.fileRow ? ', file row ' + row.fileRow : '') : '' , text: row.student.name }),
          h('td', { class: 'mhp-adm', text: row.student.admission_no }),
          h('td', null, [h('span', { class: 'mhp-pill mhp-' + st[1], text: st[0] })])
        ]);
        for (var q = 0; q < row.cells.length; q++) {
          var cell = row.cells[q], td;
          if (cell.state === 'ok') td = h('td', { class: 'mhp-num', text: String(cell.value) });
          else if (cell.state === 'invalid') td = h('td', { class: 'mhp-num mhp-cell-bad', title: cell.reason, text: String(cell.raw) + ' ✕' });
          else if (cell.state === 'locked') td = h('td', { class: 'mhp-num mhp-cell-muted', text: cell.current || '🔒' });
          else td = h('td', { class: 'mhp-num mhp-cell-miss', text: 'not set' });
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      if (!shown) tbody.appendChild(h('tr', null, [h('td', { colspan: String(3 + cols.length), class: 'mhp-empty', text: 'Nothing needs attention. Every student has every mark.' })]));
      content.appendChild(h('div', { class: 'mhp-table-wrap' }, [h('table', { class: 'mhp-table' }, [h('thead', null, [thead]), tbody])]));

      // file rows that are not in this class
      if (report.unknown.length) {
        var ul = h('ul', { class: 'mhp-list' });
        for (var u = 0; u < report.unknown.length; u++) {
          var rec = report.unknown[u];
          ul.appendChild(h('li', { text: (rec.name || '(no name)') + (rec.admission_no ? ' · ' + rec.admission_no : '') + ' · file row ' + rec.row }));
        }
        content.appendChild(h('details', { class: 'mhp-details' }, [h('summary', { text: 'In the file but not in this class (' + report.unknown.length + ')' }), ul]));
      }
      if (report.duplicates.length) {
        var ul2 = h('ul', { class: 'mhp-list' });
        for (var d = 0; d < report.duplicates.length; d++) {
          var dup = report.duplicates[d];
          ul2.appendChild(h('li', { text: dup.student.name + ' appears again on file row ' + dup.record.row + '. Only the first row is used.' }));
        }
        content.appendChild(h('details', { class: 'mhp-details', open: 'open' }, [h('summary', { text: 'Duplicate rows (' + report.duplicates.length + ')' }), ul2]));
      }

      // buttons
      var validStudents = c.ready + c.partial + c.invalid;
      fillReady.textContent = 'Fill ' + c.ready + ' complete student' + (c.ready === 1 ? '' : 's');
      fillReady.disabled = !c.ready;
      fillValid.textContent = 'Fill every valid mark (' + validStudents + ' students)';
      fillValid.disabled = !validStudents;
    }

    function chip(n, label, kind) { return h('span', { class: 'mhp-chip mhp-' + kind }, [h('b', { text: String(n) }), ' ' + label]); }
    function tab(key, label) {
      return h('button', { type: 'button', role: 'tab', class: 'mhp-tab', 'aria-selected': state.filter === key ? 'true' : 'false', text: label,
        onclick: function () { state.filter = key; render(); } });
    }

    function doFill(mode) {
      var res = MHP.fill(document, state.report, mode);
      m.close();
      store.set(STORE_KEY, { at: Date.now(), ctx: ctx, expected: res.expected, filled: res.filled, students: res.students, source: sourceName });
      var c = state.report.counts;
      var notes = [];
      function n(k, one, many) { return k + ' ' + (k === 1 ? one : many); }
      if (mode === 'ready' && c.partial) notes.push(n(c.partial, 'student with missing marks was left empty', 'students with missing marks were left empty'));
      if (mode === 'ready' && c.invalid) notes.push(n(c.invalid, 'student with an invalid mark was left empty', 'students with invalid marks were left empty'));
      if (mode !== 'ready' && c.partial) notes.push(n(c.partial, 'student is missing some marks', 'students are missing some marks'));
      if (mode !== 'ready' && c.invalid) notes.push(n(c.invalid, 'invalid mark was not entered', 'students have invalid marks that were not entered'));
      if (c.none) notes.push(n(c.none, 'student has no marks in the file', 'students have no marks in the file'));
      if (notes.length) notes[notes.length - 1] += ' (red boxes)';
      say('Filled ' + res.filled + ' marks for ' + res.students + ' students.' + (notes.length ? '\n' + notes.join(' · ') + '.' : '') +
          '\n\nNothing is saved yet. Check the page, then click "Submit Marks". Open this page again afterwards and it will verify what Fedena saved.', 'ok');
      var first = document.querySelector('[data-mhp="missing"],[data-mhp="invalid"]') || document.querySelector('[data-mhp="filled"]');
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    fillReady.addEventListener('click', function () { doFill('ready'); });
    fillValid.addEventListener('click', function () { doFill('valid'); });
    render();
  }

  // ---------- verification ----------
  function runVerify(manual) {
    store.get(STORE_KEY, function (pending) {
      if (!pending || !pending.expected || Date.now() - pending.at > KEEP_MS) {
        if (manual) say('There is no recent fill to verify on this page. Fill the marks with Marks Helper Pro first.', 'warn');
        return;
      }
      var res = MHP.verify(document, pending.expected);
      var allOk = res.total > 0 && res.matched === res.total;
      verifyCard.hidden = false;
      verifyCard.className = 'mhp-verify ' + (allOk ? 'mhp-ok' : 'mhp-bad');
      verifyCard.innerHTML = '';
      verifyCard.appendChild(h('b', { text: allOk ? '✓ Verified: ' + res.matched + '/' + res.total + ' marks match' : '✕ ' + (res.total - res.matched) + ' of ' + res.total + ' marks do not match' }));
      verifyCard.appendChild(h('span', { text: 'Compared with the file filled on ' + new Date(pending.at).toLocaleString() + '.' }));
      if (!allOk) {
        var ul = h('ul', { class: 'mhp-list' });
        for (var i = 0; i < Math.min(res.problems.length, 8); i++) {
          var p = res.problems[i];
          ul.appendChild(h('li', { text: p.name + ' · ' + p.column + ': expected ' + p.expected + ', Fedena has ' + (p.saved === '' ? 'nothing' : p.saved) }));
        }
        if (res.problems.length > 8) ul.appendChild(h('li', { text: '… and ' + (res.problems.length - 8) + ' more (see the receipt)' }));
        verifyCard.appendChild(ul);
      }
      verifyCard.appendChild(h('div', { class: 'mhp-row' }, [
        h('button', { class: 'mhp-btn', type: 'button', text: 'Download receipt', onclick: function () {
          download('marks-receipt_' + safeName(ctx.subject) + '_' + safeName(ctx.batch) + '_' + stamp().replace(/[: ]/g, '-') + '.csv', MHP.receiptCsv(ctx, res, stamp()));
        } }),
        h('button', { class: 'mhp-btn mhp-ghost', type: 'button', text: 'Done', onclick: function () { store.del(STORE_KEY); verifyCard.hidden = true; say('Verification cleared.'); } })
      ]));
      if (manual) say(allOk ? 'Every filled mark is on the page.' : 'Some marks differ. Check the list above.', allOk ? 'ok' : 'bad');
    });
  }

  // On load: if this page was filled before and is now locked (submitted), verify automatically.
  store.get(STORE_KEY, function (pending) {
    if (pending && pending.expected && Date.now() - pending.at <= KEEP_MS && locked > 0) runVerify(false);
  });
})();
