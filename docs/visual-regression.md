# Visual regression tests

Playwright visual tests capture screenshots for key UI pages and compare them
against baselines to detect unintended UI changes.

## Running locally

- Update baselines: `yarn test:visual:update`
- Compare against current baselines: `yarn test:visual`

The visual tests run in mock mode, use fixed mock timestamps, and disable
animations for stable snapshots.

## Handling nondeterministic UI

- Prefer deterministic mock data first. Keep timestamps, random IDs, and seeded
  lists derived from the fixed mock time instead of `Date.now()`.
- If time needs to be frozen in the browser, use Playwright Clock
  (`page.clock.setFixedTime(...)`) for the test or test suite.
- If a small region is intentionally dynamic, mask it with `toHaveScreenshot`
  options (`mask`, `maskColor`, or `stylePath`) rather than loosening the whole
  diff.
- If you must allow small pixel drift, use `maxDiffPixels`,
  `maxDiffPixelRatio`, or `threshold` on that specific screenshot assertion.

Note: Snapshots are OS-specific. CI runs on Windows, so baselines use the
win32 suffix. If you update snapshots on macOS or Linux, expect different
filenames and diffs.

## CI behavior

- PRs run the Visual Regression job.
- The job checks out base branch snapshots, runs visual tests on the PR, and
  uploads artifacts:
  - `playwright-report` HTML report
  - `test-results` with expected, actual, and diff images
  - `visual-summary.md` with the change list
- A PR comment is posted with the summary and a link to the Actions run.

## Adding new views

- Add a new `@visual` test in `test/e2e/visual.spec.ts`.
- Run `yarn test:visual:update`.
- Commit the new snapshots in `test/e2e/visual.spec.ts-snapshots`.
