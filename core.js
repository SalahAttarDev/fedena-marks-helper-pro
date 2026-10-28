// Marks Helper Pro — core logic (no UI).
// Reads Fedena's Gradebook "Mark Entry" page, reads a marks file (xlsx / csv / json / pasted table),
// matches students, checks every mark, fills, and verifies what Fedena saved.
// Plain loops only: Fedena's Prototype.js replaces some Array methods on the page.
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  function norm(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function nameKey(s) {
    // order-independent name key: "Tan Wei Hugo" == "HUGO TAN WEI"
    var parts = String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
    out.sort();
    return out.join(' ');
  }
  function toNumber(v) {
    if (v === null || v === undefined) return { blank: true };
    if (typeof v === 'number') return isFinite(v) ? { value: v } : { bad: String(v) };
    var s = String(v).trim();
    if (s === '' || s === '-' || s === '—') return { blank: true };
    if (/^(ab|abs|absent)$/i.test(s)) return { absent: true };
    var n = Number(s.replace(',', '.'));
    return isFinite(n) ? { value: n } : { bad: s };
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Column aliases: page column name -> words a spreadsheet might use for it.
  var ALIASES = {
    HW: ['HW', 'HOMEWORK', 'HWAVG'],
    ORAL: ['ORAL', 'OR', 'ORALAVG', 'SPEAKING'],
    CW: ['CW', 'CLASSWORK', 'CWAVG'],
    ATTND: ['ATTND', 'ATT', 'ATTD', 'ATTENDANCE', 'ATTAVG']
  };
  function aliasesFor(colName) {
    var k = norm(colName);
    var list = ALIASES[k] ? ALIASES[k].slice() : [];
    if (list.indexOf(k) === -1) list.unshift(k);
    return list;
  }

  // ---------- reading the Fedena page ----------
  function markInputs(doc) {
    return Array.prototype.slice.call((doc || document).querySelectorAll('input[name*="[marks]"][student_id][assess_id]'));
  }

  function pageColumns(doc) {
    doc = doc || document;
    var inputs = markInputs(doc), ids = [];
    for (var i = 0; i < inputs.length; i++) {
      var a = inputs[i].getAttribute('assess_id');
      if (ids.indexOf(a) === -1) ids.push(a);
    }
    var skip = /^(absent|grade|final score|no\.?|student|admission no\.?|\d+(\.\d+)?)$/i;
    var names = [], rows = doc.querySelectorAll('table tr');
    for (var r = 0; r < rows.length && !names.length; r++) {
      var cells = rows[r].children, found = [];
      for (var c = 0; c < cells.length; c++) {
        var t = text(cells[c]);
        if (t && !skip.test(t)) found.push(t);
      }
      if (ids.length && found.length >= ids.length) names = found.slice(0, ids.length);
    }
    var cols = [];
    for (var j = 0; j < ids.length; j++) {
      var first = doc.querySelector('input[assess_id="' + ids[j] + '"][max_marks]');
      cols.push({ id: ids[j], name: names[j] || ('Column ' + (j + 1)), max: first ? parseFloat(first.getAttribute('max_marks')) : null });
    }
    return cols;
  }

  function pageStudents(doc) {
    doc = doc || document;
    var inputs = markInputs(doc), seen = {}, list = [];
    for (var k = 0; k < inputs.length; k++) {
      var sid = inputs[k].getAttribute('student_id');
      if (seen[sid]) continue;
      seen[sid] = true;
      var nameCell = doc.getElementById('st_' + sid);
      var row = nameCell && nameCell.closest('tr');
      list.push({ sid: sid, name: text(nameCell), admission_no: text(row && row.querySelector('.adn_number')) });
    }
    return list;
  }

  function pageContext(doc) {
    doc = doc || document;
    var info = {}, labels = ['Exam Group', 'Grade', 'Batch', 'Subject Exam', 'Maximum Marks'];
    var els = doc.querySelectorAll('div, td, span, th');
    for (var i = 0; i < els.length; i++) {
      var t = text(els[i]);
      if (labels.indexOf(t) !== -1 && !info[t]) {
        var next = els[i].nextElementSibling;
        if (next) info[t] = text(next);
      }
    }
    return {
      exam: (info['Exam Group'] || '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim(),
      grade: info['Grade'] || '', batch: info['Batch'] || '', subject: info['Subject Exam'] || '',
      max_total: info['Maximum Marks'] || ''
    };
  }

  function box(doc, sid, colId) {
    return (doc || document).querySelector('input[student_id="' + sid + '"][assess_id="' + colId + '"][name*="[marks]"]');
  }

  // ---------- reading a marks file into tables ----------
  // Every source becomes: { sheets: [{ name, rows: [[cell, ...], ...] }], json: <object|null> }
  function tablesFromText(raw) {
    var t = String(raw || '').replace(/^﻿/, '').trim();
    if (!t) throw new Error('The pasted text is empty.');
    var stripped = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (stripped.charAt(0) === '{' || stripped.charAt(0) === '[') {
      return { sheets: [], json: JSON.parse(stripped) };
    }
    // TSV (copied from Excel / Google Sheets) or CSV
    var lines = t.split(/\r?\n/), delim = lines[0].indexOf('\t') !== -1 ? '\t' : (lines[0].indexOf(';') !== -1 && lines[0].indexOf(',') === -1 ? ';' : ',');
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      rows.push(delim === '\t' ? lines[i].split('\t') : splitCsvLine(lines[i], delim));
    }
    return { sheets: [{ name: 'Pasted table', rows: rows }], json: null };
  }

  function splitCsvLine(line, delim) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function tablesFromWorkbook(XLSX, arrayBuffer) {
    var wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    var sheets = [];
    for (var i = 0; i < wb.SheetNames.length; i++) {
      var ws = wb.Sheets[wb.SheetNames[i]];
      sheets.push({ name: wb.SheetNames[i], rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }) });
    }
    return { sheets: sheets, json: null };
  }

  // ---------- finding the header row and columns in a sheet ----------
  function scoreHeader(row, cols) {
    var found = { name: -1, adm: -1, cols: {} }, score = 0;
    for (var c = 0; c < row.length; c++) {
      // ignore "(/10)", "(max 10)" etc. so our own template headings match: "HW (/10)" -> "HW"
      var h = norm(String(row[c] == null ? '' : row[c]).replace(/\([^)]*\)/g, ''));
      if (!h) continue;
      if (found.adm === -1 && /^(ADM|ADMISSION|ADMNO|ADMISSIONNO|ADMISSIONNUMBER|STUDENTID|ID)$/.test(h)) { found.adm = c; score += 2; continue; }
      if (found.name === -1 && /(STUDENTNAME|^NAME$|^STUDENT$|FULLNAME)/.test(h)) { found.name = c; score += 2; continue; }
      for (var j = 0; j < cols.length; j++) {
        if (found.cols[cols[j].id] !== undefined) continue;
        if (aliasesFor(cols[j].name).indexOf(h) !== -1) { found.cols[cols[j].id] = c; score += 1; break; }
      }
    }
    return { score: score, found: found };
  }

  // Best header row in each sheet; returns sheets sorted by how well they fit the page.
  function analyseSheets(tables, cols) {
    var out = [];
    for (var s = 0; s < tables.sheets.length; s++) {
      var sh = tables.sheets[s], best = null;
      var limit = Math.min(sh.rows.length, 40);
      for (var r = 0; r < limit; r++) {
        var res = scoreHeader(sh.rows[r] || [], cols);
        if (!best || res.score > best.score) best = { score: res.score, headerRow: r, found: res.found };
      }
      if (best) {
        // A two-row header (e.g. "Term Marks" over "HW BLC CW Att"): pick up names/adm from the row above.
        if (best.headerRow > 0 && (best.found.name === -1 || best.found.adm === -1)) {
          var above = scoreHeader(sh.rows[best.headerRow - 1] || [], []);
          if (best.found.name === -1 && above.found.name !== -1) best.found.name = above.found.name;
          if (best.found.adm === -1 && above.found.adm !== -1) best.found.adm = above.found.adm;
        }
        best.name = sh.name;
        best.index = s;
        // Labels for the column pickers: this row's heading, or the one above it for two-row headings.
        var cur = sh.rows[best.headerRow] || [], up = best.headerRow > 0 ? (sh.rows[best.headerRow - 1] || []) : [];
        best.headers = [];
        for (var hc = 0; hc < Math.max(cur.length, up.length); hc++) {
          var lab = cur[hc] != null && String(cur[hc]).trim() ? String(cur[hc]).trim() : (up[hc] != null ? String(up[hc]).trim() : '');
          best.headers.push({ index: hc, label: lab });
        }
        out.push(best);
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  // Turn a sheet (with a chosen mapping) into marks records.
  function recordsFromSheet(sheet, map) {
    var recs = [];
    for (var r = map.headerRow + 1; r < sheet.rows.length; r++) {
      var row = sheet.rows[r] || [];
      var name = map.name >= 0 ? row[map.name] : null;
      var adm = map.adm >= 0 ? row[map.adm] : null;
      if (!String(name == null ? '' : name).trim() && !String(adm == null ? '' : adm).trim()) continue;
      var marks = {};
      for (var id in map.cols) if (map.cols.hasOwnProperty(id) && map.cols[id] >= 0) marks[id] = row[map.cols[id]];
      recs.push({ row: r + 1, name: name == null ? '' : String(name).trim(), admission_no: adm == null ? '' : String(adm).trim(), marks: marks });
    }
    return recs;
  }

  // JSON (our template format) -> records keyed by page column id.
  function recordsFromJson(json, cols) {
    var list = Array.isArray(json) ? json : (json && json.students);
    if (!Array.isArray(list)) throw new Error('The JSON must contain a "students" list.');
    var byName = {};
    for (var j = 0; j < cols.length; j++) {
      var al = aliasesFor(cols[j].name);
      for (var a = 0; a < al.length; a++) byName[al[a]] = cols[j].id;
    }
    var recs = [], unknownCols = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i] || {}, marks = {};
      var src = s.marks || {};
      for (var k in src) {
        if (!src.hasOwnProperty(k)) continue;
        var id = byName[norm(k)];
        if (id) marks[id] = src[k];
        else if (unknownCols.indexOf(k) === -1) unknownCols.push(k);
      }
      recs.push({ row: i + 1, name: s.name || '', admission_no: s.admission_no || '', marks: marks });
    }
    return { records: recs, unknownCols: unknownCols };
  }

  // ---------- matching + checking ----------
  // Returns a full report of what would happen, without touching the page.
  function analyse(doc, records) {
    var cols = pageColumns(doc), students = pageStudents(doc);
    var byAdm = {}, byName = {}, byKey = {};
    for (var i = 0; i < students.length; i++) {
      var st = students[i];
      if (st.admission_no) byAdm[norm(st.admission_no)] = st;
      byName[norm(st.name)] = byName[norm(st.name)] ? 'DUP' : st;
      byKey[nameKey(st.name)] = byKey[nameKey(st.name)] ? 'DUP' : st;
    }

    var used = {}, unknown = [], duplicates = [];
    var perStudent = {};
    for (var r = 0; r < records.length; r++) {
      var rec = records[r], match = null, how = '';
      if (rec.admission_no && byAdm[norm(rec.admission_no)]) { match = byAdm[norm(rec.admission_no)]; how = 'admission no.'; }
      else if (rec.name && byName[norm(rec.name)] && byName[norm(rec.name)] !== 'DUP') { match = byName[norm(rec.name)]; how = 'name'; }
      else if (rec.name && byKey[nameKey(rec.name)] && byKey[nameKey(rec.name)] !== 'DUP') { match = byKey[nameKey(rec.name)]; how = 'name (reordered)'; }
      if (!match) { unknown.push(rec); continue; }
      if (used[match.sid]) { duplicates.push({ record: rec, student: match }); continue; }
      used[match.sid] = true;
      perStudent[match.sid] = { record: rec, how: how };
    }

    var rows = [], counts = { ready: 0, partial: 0, invalid: 0, none: 0, locked: 0 };
    for (var s = 0; s < students.length; s++) {
      var stu = students[s], hit = perStudent[stu.sid], cells = [], missing = 0, bad = 0, ok = 0, locked = 0;
      for (var c = 0; c < cols.length; c++) {
        var col = cols[c], b = box(doc, stu.sid, col.id), cell = { col: col, current: b ? b.value : '' };
        if (b && b.disabled) { cell.state = 'locked'; locked++; }
        else if (!hit || !(col.id in hit.record.marks)) { cell.state = 'missing'; missing++; }
        else {
          var n = toNumber(hit.record.marks[col.id]);
          if (n.blank) { cell.state = 'missing'; missing++; }
          else if (n.absent) { cell.state = 'invalid'; cell.reason = 'marked absent: use Fedena\'s Absent box'; cell.raw = hit.record.marks[col.id]; bad++; }
          else if (n.bad !== undefined) { cell.state = 'invalid'; cell.reason = 'not a number'; cell.raw = n.bad; bad++; }
          else if (n.value < 0 || (col.max !== null && n.value > col.max)) { cell.state = 'invalid'; cell.reason = 'outside 0–' + col.max; cell.raw = n.value; bad++; }
          else { cell.state = 'ok'; cell.value = round2(n.value); ok++; }
        }
        cells.push(cell);
      }
      var status;
      if (locked === cols.length) status = 'locked';
      else if (!hit) status = 'none';
      else if (bad) status = 'invalid';
      else if (missing) status = 'partial';
      else status = 'ready';
      counts[status]++;
      rows.push({ student: stu, status: status, how: hit ? hit.how : '', fileRow: hit ? hit.record.row : null, cells: cells });
    }
    return { columns: cols, rows: rows, counts: counts, unknown: unknown, duplicates: duplicates, total: students.length };
  }

  // ---------- filling ----------
  function fire(el) {
    var evs = ['input', 'change', 'keyup', 'blur'];
    for (var i = 0; i < evs.length; i++) el.dispatchEvent(new Event(evs[i], { bubbles: true }));
  }

  // mode: 'ready' = only students with every mark valid; 'valid' = every valid mark, incl. partial students.
  function fill(doc, report, mode) {
    var expected = {}, filled = 0, students = 0;
    for (var i = 0; i < report.rows.length; i++) {
      var row = report.rows[i];
      if (row.status === 'locked' || row.status === 'none') continue;
      var skipRow = mode === 'ready' && row.status !== 'ready';
      var any = false;
      for (var c = 0; c < row.cells.length; c++) {
        var cell = row.cells[c], b = box(doc, row.student.sid, cell.col.id);
        if (!b) continue;
        if (skipRow) {
          // left empty on purpose: mark the whole student so the teacher sees why
          if (!b.disabled) b.setAttribute('data-mhp', cell.state === 'invalid' ? 'invalid' : 'missing');
          continue;
        }
        if (cell.state === 'ok') {
          b.value = String(cell.value);
          fire(b);
          b.setAttribute('data-mhp', 'filled');
          (expected[row.student.sid] = expected[row.student.sid] || {})[cell.col.id] = cell.value;
          filled++; any = true;
        } else if (cell.state === 'invalid' || cell.state === 'missing') {
          b.setAttribute('data-mhp', cell.state);
        }
      }
      if (any) students++;
    }
    for (var j = 0; j < report.rows.length; j++) {
      var r = report.rows[j];
      if (r.status === 'none') {
        for (var k = 0; k < r.cells.length; k++) {
          var bx = box(doc, r.student.sid, r.cells[k].col.id);
          if (bx && !bx.disabled) bx.setAttribute('data-mhp', 'missing');
        }
      }
    }
    return { filled: filled, students: students, expected: expected };
  }

  // ---------- verification ----------
  // Compare what is now in Fedena's boxes with what we expected.
  function verify(doc, expected) {
    var students = pageStudents(doc), cols = pageColumns(doc), byId = {};
    for (var i = 0; i < students.length; i++) byId[students[i].sid] = students[i];
    var colName = {};
    for (var c = 0; c < cols.length; c++) colName[cols[c].id] = cols[c].name;
    var matched = 0, total = 0, problems = [], lines = [];
    for (var sid in expected) {
      if (!expected.hasOwnProperty(sid)) continue;
      for (var colId in expected[sid]) {
        if (!expected[sid].hasOwnProperty(colId)) continue;
        total++;
        var want = expected[sid][colId], b = box(doc, sid, colId);
        var got = b ? toNumber(b.value) : { blank: true };
        var ok = got.value !== undefined && Math.abs(got.value - want) < 0.005;
        var st = byId[sid] || { name: '(student ' + sid + ')', admission_no: '' };
        lines.push({ name: st.name, admission_no: st.admission_no, column: colName[colId] || colId, expected: want, saved: b ? b.value : '(missing)', ok: ok });
        if (ok) matched++; else problems.push(lines[lines.length - 1]);
      }
    }
    return { matched: matched, total: total, problems: problems, lines: lines };
  }

  function receiptCsv(ctx, result, when) {
    function q(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var out = [
      ['Marks Helper Pro verification receipt'], ['Exam', ctx.exam], ['Subject', ctx.subject], ['Batch', ctx.batch],
      ['Checked at', when], ['Result', result.matched + ' of ' + result.total + ' marks match'], [],
      ['Student', 'Admission No.', 'Column', 'Expected', 'Saved in Fedena', 'Status']
    ];
    for (var i = 0; i < result.lines.length; i++) {
      var l = result.lines[i];
      out.push([l.name, l.admission_no, l.column, l.expected, l.saved, l.ok ? 'OK' : 'MISMATCH']);
    }
    return out.map(function (r) { return r.map(q).join(','); }).join('\r\n');
  }

  function templateCsv(doc) {
    var cols = pageColumns(doc), st = pageStudents(doc);
    var head = ['Admission No.', 'Student Name'];
    for (var c = 0; c < cols.length; c++) head.push(cols[c].name + (cols[c].max !== null ? ' (/' + cols[c].max + ')' : ''));
    var out = [head];
    for (var i = 0; i < st.length; i++) {
      var r = [st[i].admission_no, st[i].name];
      for (var k = 0; k < cols.length; k++) r.push('');
      out.push(r);
    }
    return out.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
  }

  root.MHP = {
    norm: norm, nameKey: nameKey, toNumber: toNumber, aliasesFor: aliasesFor,
    pageColumns: pageColumns, pageStudents: pageStudents, pageContext: pageContext,
    tablesFromText: tablesFromText, tablesFromWorkbook: tablesFromWorkbook, analyseSheets: analyseSheets,
    recordsFromSheet: recordsFromSheet, recordsFromJson: recordsFromJson,
    analyse: analyse, fill: fill, verify: verify, receiptCsv: receiptCsv, templateCsv: templateCsv
  };
})(typeof window !== 'undefined' ? window : this);
