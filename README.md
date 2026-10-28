<p align="center"><img src="icons/icon-128.png" width="96" alt="Marks Helper Pro logo"></p>

# Marks Helper Pro

A Chrome and Firefox extension that **checks and fills Fedena Gradebook marks** from a teacher's own file, then **verifies what Fedena saved**. It never submits on its own.

Works on Fedena's **Gradebook → Manage Exams → Enter marks** page (`/assessments/attribute_scores`), for exams made of mark columns such as **HW, Oral, Cw, Attnd** (each /10).

## What it does

| Step | What happens |
|---|---|
| **1. Drop a file** | Drag the CA tracker (`.xlsx`), a CSV, or the JSON file onto the panel. Or paste rows copied from Excel / Google Sheets. |
| **2. Check** | Before anything is filled, a check screen lists every student: **ready**, **missing marks**, **invalid** (e.g. 12/10, "abs", text), **no marks in file**, and rows **in the file but not in this class**. |
| **3. Map columns** | Columns are matched by heading (HW, Oral/OR, Cw, Attnd/Att…). Anything not found is shown in red and can be picked from a list, e.g. *BLC → Oral*. |
| **4. Fill** | *Fill complete students* only, or *fill every valid mark*. Filled boxes turn green, problems red. Fedena recalculates grades and totals itself. |
| **5. Submit** | The teacher checks the page and clicks Fedena's **Submit Marks**. |
| **6. Verify** | Reopen the page: it compares what Fedena saved with what was filled (`49/49 marks match ✓`) and offers a **receipt** (CSV). |

Students are matched by **admission number**, then by **name** (word order and capitals do not matter). Duplicate rows are reported.

## Install

- **Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
- **Firefox:** `about:addons` → ⚙️ → **Install Add-on From File** → the `.xpi`, then turn on access to **fedena.com** under *Permissions*.

## Privacy

- Runs only on Fedena's mark entry page, with the teacher's own login.
- Student marks never leave the browser. Nothing is sent to any server.
- The last fill is kept in the browser's extension storage (no names) for up to 14 days so it can be verified, then removed. **Done** clears it at once.

## Files

| File | Purpose |
|---|---|
| `core.js` | Reading the page and files, matching, checking, filling, verifying (no UI) |
| `ui.js` | Panel, check screen, verification card |
| `panel.css` | Styles, scoped to the extension's own elements |
| `lib/xlsx.full.min.js` | [SheetJS](https://sheetjs.com) 0.20.3 for reading Excel files (Apache 2.0, see `lib/SHEETJS-LICENSE`) |
| `test/` | A fake mark entry page and sample files with **invented** students, for testing without Fedena |

To try it without Fedena: serve the folder (`python3 -m http.server`) and open `test/fedena-mark-entry.fixture.html`, then drop `test/sample-ca-tracker.xlsx` or `test/sample-marks.csv` on the panel.
