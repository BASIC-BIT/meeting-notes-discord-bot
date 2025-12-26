# UI/UX Notes (Playwright Spot Check)

Date: 2025-12-20
Scope: Mocked portal flows + home page (dark/light)

## Issues / UX observations

- Theme toggle logs a console error on each toggle: "a style property during rerender ... conflicting property" (seen on home page).
- Server select page shows full left nav (Library/Ask/Billing/Settings) before a server is chosen. Feels confusing; consider hiding/disabled nav until server selection.
- "Open portal" button remains visible on portal pages; could be redundant. Consider swapping to "Switch server" or a breadcrumb/selector.
- Meeting modal audio shows 0:00/0:00 in mock; makes the audio card look broken. Consider mock duration or disabled player state with helper text.
- Ask page: selected conversation state could be stronger (clearer accent, border/glow). Spacing between items could be slightly tighter to read as a thread list.
- Billing: expanded "Plans" section feels visually heavy; tighten spacing and reduce card chrome. Current plan card can be visually quieter to reduce noise.
- Settings: "Add rule" action feels slightly detached from the form (bottom-right). Consider a footer row with action + helper text, or inline button near fields.
- Several secondary text blocks on dark backgrounds are low contrast (home, library, billing). Slightly bump dimmed color or card contrast.

## Screenshots captured

- screens/home-dark.png
- screens/home-light.png
- screens/portal-select.png
- screens/library.png
- screens/meeting-modal.png
- screens/ask.png
- screens/billing.png
- screens/billing-plans-expanded.png
- screens/settings.png
- screens/settings-after-add-rule.png
- screens/settings-all-voice.png
