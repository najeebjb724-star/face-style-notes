# Action Card and Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 30-day list with selectable recommendation cards, reminder presets, locally persisted milestone check-ins, and downloadable calendar events.

**Architecture:** Keep the project as one `index.html`. Generate action-card data inside the pure `FaceStyleCore` report composer, while browser-only selection, persistence, rendering, and ICS export remain in the page script. Persist only action progress metadata under one versioned local-storage key.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js built-in test runner, localStorage, RFC 5545-compatible ICS text.

## Global Constraints

- Do not add dependencies or split the single-file application.
- Do not store the uploaded photo, landmarks, or face measurements.
- Do not introduce attractiveness scores, medical claims, or defect language.
- Every user choice must be card- or button-based; no free-text action setup.
- The web implementation downloads `.ics`; WeChat calendar APIs remain a documented future adapter.

---

### Task 1: Action recommendation data

**Files:**
- Modify: `index.html`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: `composeReport({ quality, measurements, profile })`
- Produces: `report.actionCards: Array<{id,title,reason,action,duration,cost,successSignal,stopRule,searchKeyword}>`

- [ ] **Step 1: Replace the existing action-plan assertion with card contract assertions**

Assert that a complete profile returns exactly three cards, unique IDs, and non-empty decision fields; assert an incomplete profile still returns one safe geometry card.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/face-style-core.test.cjs`

Expected: FAIL because `report.actionCards` is not defined.

- [ ] **Step 3: Generate the minimal card data in `composeReport`**

Build cards from the existing `eyeRule`, `hairNote`, care guidance, profile goal, and same-condition photo comparison. Return `actionCards` and remove the fixed numbered `actionPlan` output.

- [ ] **Step 4: Run the core tests**

Run: `node --test tests/face-style-core.test.cjs`

Expected: PASS.

### Task 2: Selectable card, reminder, and milestone interface

**Files:**
- Modify: `index.html`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Consumes: `report.actionCards`
- Produces: DOM IDs `actionCards`, `reminderCards`, `milestoneList`, `calendarButton`, `clearActionButton`; browser functions `selectActionCard`, `selectReminder`, `toggleMilestone`, `renderActionWorkspace`

- [ ] **Step 1: Add page-structure assertions**

Assert the required DOM IDs, the storage key, and action handlers appear in `index.html`.

- [ ] **Step 2: Run tests and verify the new assertions fail**

Run: `node --test tests/face-style-core.test.cjs`

Expected: FAIL on the first missing action workspace ID.

- [ ] **Step 3: Replace the old action list markup and styles**

Add three selectable recommendation cards, three reminder preset buttons, three milestone buttons, a contextual calendar button, a clear-progress action, selected states, responsive layouts, focus styles, and concise privacy copy.

- [ ] **Step 4: Implement selection and rendering**

Use event delegation to select one action and one reminder. Update `aria-pressed`, selected styling, milestone labels, and the report’s monthly-focus summary without requiring typed input.

- [ ] **Step 5: Run tests**

Run: `node --test tests/face-style-core.test.cjs`

Expected: PASS.

### Task 3: Local persistence and calendar download

**Files:**
- Modify: `index.html`
- Test: `tests/face-style-core.test.cjs`

**Interfaces:**
- Produces: `ACTION_STORAGE_KEY`, `loadActionState()`, `saveActionState()`, `buildCalendarText()`, `downloadCalendar()`
- State shape: `{version:1, actionId:string, reminderId:"milestones"|"weekly"|"none", reminderTime:"08:00"|"12:30"|"21:30", startedAt:string, completed:string[]}`

- [ ] **Step 1: Add deterministic calendar helper tests**

Expose a pure `buildCalendarText(card, reminderId, startedAt)` through `FaceStyleCore`; assert the output has `BEGIN:VCALENDAR`, the selected title, and three `VEVENT` blocks for milestone mode or `RRULE:FREQ=WEEKLY;COUNT=4` for weekly mode.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/face-style-core.test.cjs`

Expected: FAIL because `buildCalendarText` is undefined.

- [ ] **Step 3: Implement calendar serialization and download**

Build deterministic all-day events with escaped ICS text and CRLF line endings. Download a UTF-8 `.ics` Blob only when an action is selected and reminders are enabled.

- [ ] **Step 4: Implement guarded persistence**

Read and validate the versioned state; catch storage errors; save after action selection, reminder selection, milestone toggles, and clear-progress. Persist no image or measurement values.

- [ ] **Step 5: Run the full test suite**

Run: `node --test tests/face-style-core.test.cjs`

Expected: all tests PASS.

### Task 4: End-to-end browser verification

**Files:**
- Modify only if verification finds a defect: `index.html`

**Interfaces:**
- Verifies the complete user path without changing public interfaces.

- [ ] **Step 1: Open the local page and complete an analysis**

Verify the report presents exactly three action cards and that selecting one reveals the reminder and milestone controls.

- [ ] **Step 2: Verify persistence**

Select a reminder, complete a milestone, reload the page, generate/open the report again, and confirm the state is restored.

- [ ] **Step 3: Verify calendar output**

Download the milestone `.ics` file and confirm it contains three dated events with the selected action title.

- [ ] **Step 4: Run final automated tests and inspect the diff**

Run: `node --test tests/face-style-core.test.cjs`

Run: `git diff --check`

Expected: all tests PASS and no whitespace errors.
