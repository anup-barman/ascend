---
name: ascend-ui-verification
description: Use after creating or changing any ICPC Ascend UI route, dashboard, chart, onboarding step, settings screen, training flow, contest mode, or loading/error state. Requires rendered verification, not just code review.
---

# Ascend UI Verification

## Workflow
1. Start the actual app using documented project commands. Confirm the page being inspected is the current build, not a stale dev server.
2. Exercise the relevant user flow in a real browser/webview automation setup and inspect rendered output, console errors, and failed network/API calls.
3. Capture screenshots at desktop and narrow viewport sizes. Verify hierarchy, alignment, text truncation, chart legibility, scrolling, and navigation.
4. Test loading, empty, stale/partial cache, offline, provider failure, validation failure, and successful data states when relevant.
5. Check keyboard-only navigation, logical focus order, visible focus styles, accessible names, color contrast, reduced-motion preferences, and semantic controls.
6. Interact with every changed control. A visual control is not complete unless its action and persistence work.
7. Run the relevant unit/E2E tests and production build. Fix discovered issues and repeat verification.

## Reporting
State which flows and viewport sizes were tested and link/save screenshots where the environment supports it. Never claim visual verification without running the app and inspecting the rendered result. If browser automation is not configured, report that limitation rather than substituting code inspection for visual evidence.
