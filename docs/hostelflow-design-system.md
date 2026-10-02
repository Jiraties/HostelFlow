# HostelFlow Design System

Source-based reference for extending the existing frontend. Reviewed 2 October 2026.

This document describes the current visual language and gives practical guidance for new work. It does not introduce new CSS tokens, components, or application behaviour. The linked source files remain authoritative when the UI changes.

## 1. Design direction

HostelFlow is a practical staff-facing application. Screens should make information easy to scan and actions easy to find.

- Use white surfaces over a soft neutral background.
- Use rounded cards, pill controls, and restrained shadows.
- Use cyan for primary actions, selected controls, and navigation accents.
- Keep supporting labels muted and figures prominent.
- Keep visual density useful: avoid large decorative headers, excessive padding, and repeated explanations.
- Reuse the closest existing screen or component before designing a new pattern.

The closest references for new dashboard work are Analytics, Home, and the Revenue Breakdown modal. Analytics and Home cards now use the lighter shadow; chart tooltips intentionally retain the stronger shadow.

## 2. Colour tokens

These values are defined in [index.css](../frontend/src/index.css). Reference the variable rather than copying its colour into a new stylesheet.

| Token | Current value | Purpose |
| --- | --- | --- |
| `--primary-color` | `#51d1dc` | Primary actions, active controls, cyan accents |
| `--background` | `#fff` | Main surfaces and cards |
| `--light-background` | `#f6f6f6` | Neutral background and inset surfaces |
| `--text` | `#000` | Main text |
| `--green` | `rgb(30, 203, 131)` | Positive or success accents |
| `--lightGreen` | `rgb(178, 249, 226)` | Light green supporting surface |
| `--red` | `#fd4169` | Destructive actions and negative accents |
| `--light-red` | `#fd416910` | Subtle red supporting surface |
| `--field-error-color` | `#dc2626` | Form validation text and outlines |
| `--payment-method-ota` | `#4f8fda` | OTA identification |
| `--payment-method-cash` | `#4fb58a` | Cash identification |
| `--payment-method-card` | `#8b6fd6` | Card identification |
| `--payment-method-transfer` | `#d9a441` | Transfer identification |
| `--payment-method-unpaid` | `#d66f61` | Unpaid identification |

Muted text is currently component-specific: common values include `#777777`, `#8a8f98`, and Analytics' `--analytics-muted: #727982`. These are existing local values, not a single global muted-text token.

### Colour use

- Keep most surfaces neutral. Use coloured fills sparingly.
- Make chip backgrounds a light tint of their semantic colour; keep the text readable.
- Use `color-mix()` with existing tokens when a softer variation is needed.
- Combine colour with text, icons, or arrows so meaning does not depend on colour alone.
- Percentage direction and business meaning are separate: a decrease in outstanding balance can be favourable. Choose the semantic colour from the metric's agreed meaning.
- Calendar booking colours can represent status or booking source. Preserve that mapping when adding layers or controls.
- Dark mode is not currently active; its global CSS is commented out.

## 3. Typography

The global font is **IBM Plex Sans Thai**, with `sans-serif` as the fallback. Use it for Thai and English text, form controls, chart labels, and tooltips.

| Element | Existing pattern |
| --- | --- |
| Body | Weight `400`, line height `1.5` |
| Page title | `PageHeader`, weight `600`, line height `1.12` |
| Dashboard section title | Usually `1.25rem`, weight `500` |
| KPI label | Around `1rem`, regular weight, muted colour |
| Main figures | Often around `2.5rem` or a responsive `clamp()`, weight `400` |
| Updated-at text | `0.92rem` desktop; `0.78rem` in the mobile header |
| Shared tooltip | `0.78rem`, line height `1.4` |
| Field error | `0.82rem` |

At the global `640px` mobile breakpoint, `h1` is `1.55rem` and `h2` is `1.2rem`. Individual components also have their own rules.

Use tabular numerals for adjacent financial figures, percentages, and tables when alignment matters. Keep units visible and consistently placed within the same view.

## 4. Spacing, surfaces, and layout

There is no complete global spacing or radius token scale. The following are recurring source patterns, rather than new mandatory tokens.

| Pattern | Existing values |
| --- | --- |
| Desktop page padding | `.home`: `2.5rem` |
| Page section gap | `.home`: `2rem`; Home dashboard and Analytics: `1.5rem` |
| Card/grid gap | Commonly `1rem` |
| KPI card padding | Home: `1rem`; Analytics: `1.25rem` |
| Dashboard panel padding | Commonly `1.25rem`–`1.5rem` |
| Dashboard card radius | Commonly `1.35rem`–`1.5rem` |
| Basic input radius | `0.5rem` |
| Pill radius | Very large radius, such as `999px` |
| Action button radius | `2rem` |
| Tooltip radius | Shared tooltip: `0.65rem`; chart tooltip: `1rem` |

### Shadows

| Token | Value | Use |
| --- | --- | --- |
| `--light-shadow` | `rgba(149, 157, 165, 0.129) 0px 8px 24px` | Current dashboard cards and panels |
| `--main-shadow` | `rgba(149, 157, 165, 0.25) 0px 8px 24px` | Existing form/action surfaces and floating tooltips |

Avoid adding heavier shadows to ordinary dashboard cards. The stronger tooltip shadow helps the floating layer stand out from those cards.

### Application shell

- Desktop uses a CSS Grid shell with sidebar plus flexible page content.
- The shell is constrained to `100dvh`; the main page scrolls vertically.
- Set `min-width: 0` on grid/flex children that contain charts, tables, or long labels.
- Clip horizontal overflow at the page level while keeping vertical content reachable.
- Dashboard grids use `minmax(0, 1fr)` columns and reduce their column count as space decreases.
- Keep wide table scrolling within the table container.

## 5. Reusable components

| Component / source | Reuse for |
| --- | --- |
| [PageHeader](../frontend/src/components/PageHeader.tsx) | Page title, updated-at metadata, refresh action, and profile menu |
| [ActionButton](../frontend/src/components/ActionButton.tsx) | Standard actions, highlighted primary actions, disabled actions, and labelled icon-only actions |
| [StatCard](../frontend/src/features/dashboard/StatCard.tsx) | Existing dashboard values with loading skeletons, animated digits, units, and helper tooltips |
| [Tooltip](../frontend/src/components/Tooltip.tsx) | Short supporting explanations and metric definitions |
| [ConfirmationModal](../frontend/src/components/ConfirmationModal.tsx) | Confirmation flows and established destructive-action styling |
| [ModalCloseButton](../frontend/src/components/ModalCloseButton.tsx) | The shared mobile close control |
| [PreferredDateInput](../frontend/src/components/PreferredDateInput.tsx) | Date input consistent with user display preferences |
| [customStyles](../frontend/src/helpers/selectStyling.ts) | Existing `react-select` controls |
| [Sidebar](../frontend/src/components/Sidebar.tsx) | Desktop navigation and mobile navigation/More sheet |

### Page headers

Use `PageHeader` instead of building a separate title/profile system. Updated-at metadata should describe an actual update. A refresh action should have real refresh behaviour; visual prototypes should make their mock state clear.

### Buttons and segmented controls

- Primary action: cyan fill, white text and icon.
- Secondary action: white surface with a cyan icon.
- Disabled action: neutral grey, no active hover movement, native `disabled` state.
- Icon-only action: a compact circular target with a meaningful accessible name.
- Segmented control: rounded/pill group, with a cyan active segment.
- Use `aria-pressed` for toggle buttons and `aria-current="page"` for active navigation links.

### Forms

- Use visible labels and the existing input/select styles.
- Keep required and optional wording short and consistent with the surrounding form.
- Put validation meaning in text near the field, alongside the error outline.
- Use `var(--field-error-color)` for validation errors.
- Retain established confirmation and unsaved-change flows when editing forms.

### Cards and state chips

Use a simple hierarchy: label, main value, then supporting information. Do not make every label bold. A coloured pill should indicate a meaningful status, selection, or comparison rather than decorate an ordinary field.

Clickable cards should have an appropriate interactive element, keyboard access, and visible focus. Existing Analytics interactions favour subtle scale or chevron treatment over abrupt colour changes.

## 6. Navigation and mobile

Desktop navigation uses a collapsible sidebar with grouped links, muted group labels, and a cyan active treatment. Mobile uses a floating rounded navigation dock and a More sheet. Search is a full-width pill placed first in that sheet.

### Existing mobile tokens

These variables are currently defined inside `@media (max-width: 640px)` in `index.css`:

| Token | Value |
| --- | --- |
| `--mobile-page-padding` | `1rem` |
| `--mobile-section-gap` | `1rem` |
| `--mobile-card-radius` | `1.25rem` |
| `--mobile-sheet-radius` | `1.5rem` |
| `--mobile-touch-target` | `2.75rem` |
| `--mobile-shadow` | `rgba(149, 157, 165, 0.16) 0 0.4rem 1.1rem` |
| `--mobile-shadow-strong` | `rgba(96, 105, 112, 0.2) 0 0.7rem 1.7rem` |

The shell, navigation, and many modal rules switch at `760px`; dashboard rules also use `720px`, and compact adjustments often use `520px`. Reuse the owning component's breakpoint. When a mobile variable is used outside its defining breakpoint, retain an appropriate CSS fallback.

### Mobile behaviour

- Allow content to scroll vertically. Do not trap long content behind `overflow: hidden`.
- Respect safe-area insets around the dock and modal actions.
- Aim for touch targets of at least `2.75rem`.
- Existing booking and finance modals become full-width bottom sheets with rounded top corners.
- Keep modal content scrollable and retain the shared close control and accessible dialog behaviour.
- Sticky modal actions must remain visible without hiding the final content rows.
- Avoid desktop hover effects on touch-only devices.

## 7. Charts, tables, and calendar

### Analytics charts

Use the existing Recharts implementation and light panel styling as the reference.

- A combined chart uses daily revenue bars and an occupancy line.
- Give revenue and occupancy their own axes, with currency and percentage labels.
- Current Analytics revenue bars are muted cyan, rounded, borderless, and visually softer than the occupancy line.
- Current bar settings include `maxBarSize={18}`, `barCategoryGap="28%"`, and reduced fill opacity.
- The occupancy line should lead the eye. Current Analytics uses a stronger cyan line through `--analytics-occupancy-color`.
- Keep grid lines faint and avoid unnecessary chart borders.
- Include a compact legend and formatted hover values.
- Chart tooltip: white surface, `1rem` radius, `var(--main-shadow)`; ensure it appears above nearby content.
- Distinguish daily values from cumulative totals in the label and data choice.
- Make mock data recognizable as mock data; do not imply that a placeholder is a live result.

### Operational tables

Use compact, readable rows, clear headings, aligned figures, and restrained separators. Retain the existing table density preferences and filtering/search patterns instead of inventing a separate interaction system.

### Calendar

The calendar is a custom CSS Grid timeline. Extend its current structure rather than replacing it with a calendar library. Preserve single-click booking interactions and existing booking/room-block meanings.

Balcony and Window share one visual room group. Extra spacing belongs between subsequent groups, not between every room prefix. Supplemental annotations should remain visually distinct from booking bars and room blocks; the existing extra-sale treatment uses a subtle amber layer.

## 8. Language and supporting copy

The UI is bilingual in practice. Staff workflows commonly use Thai, while familiar hospitality and analytics terms remain in English.

- Preserve established terms such as Booking, Check-In, Check-Out, Occupancy, Stay Revenue, and RevPAB where the reference screen uses them.
- Use short Thai explanations for helper copy, tooltips, subtitles, validation, and supporting meaning.
- Use explicit labels for the event or source being described, particularly in financial details.
- Avoid awkward translations of industry terms and unexplained abbreviations.
- Keep action labels concrete and concise.
- Follow the language of the owning screen; this is not a rule to translate every section title into English.

## 9. Motion and accessibility

Existing controls use short transitions, commonly around `150`–`250ms`. The current mobile modal slide uses `320ms`, and its backdrop uses `220ms`. These are implementation references, not a global motion-token scale.

- Use restrained movement that communicates an interaction or state change.
- Keep focus visible and support keyboard navigation.
- Respect `prefers-reduced-motion` when adding motion.
- Preserve dialog focus handling, Escape behaviour, and focus return.
- Loading, disabled, empty, error, and success states need clear text or semantics.
- Check contrast for muted text and tinted badges; an existing token alone does not guarantee sufficient contrast.
- Decorative icons should be hidden from assistive technology; icon-only controls need accessible labels.

## 10. Source map and implementation checklist

| Source | Responsibility |
| --- | --- |
| [index.css](../frontend/src/index.css) | Global colours, typography, basic fields/buttons, and mobile tokens |
| [App.css](../frontend/src/App.css) | Application shell, scrolling, and mobile modal integration |
| [Home.css](../frontend/src/pages/Home.css) | Shared page spacing and booking/list controls |
| [Main.css](../frontend/src/pages/Main.css) | Home dashboard cards, panels, and chart controls |
| [Analytics.css](../frontend/src/pages/Analytics.css) | Analytics cards, charts, comparisons, and local tokens |
| [FinancialBreakdown.css](../frontend/src/features/finance/FinancialBreakdown.css) | Revenue Breakdown modal surface and control styling |
| [Sidebar.css](../frontend/src/components/Sidebar.css) | Desktop sidebar and mobile dock/More sheet |
| [frontend/AGENTS.md](../frontend/AGENTS.md) | Repository frontend design-consistency requirements |

Before handing off a UI change:

1. Identify the closest existing component and reuse its design language.
2. Use existing tokens and keep new local styles scoped to their owning component.
3. Check text hierarchy, spacing, focus, loading/error states, and numeric units.
4. Check desktop and mobile layouts, scrolling, wrapping, and overlay layering.
5. Use fabricated, clearly identified data for prototypes.
6. Run the relevant frontend checks; claim visual verification only when the screen was actually inspected in a browser.

### Short brief to paste into another chat

> Follow HostelFlow's existing frontend design language: IBM Plex Sans Thai; white rounded surfaces; soft neutral backgrounds; light card shadows; restrained cyan accents; muted supporting labels; regular-weight prominent figures; pill-shaped controls; Thai explanations with familiar English hospitality terms. Reuse PageHeader, ActionButton, shared Tooltip, form styles, and established modal/navigation patterns. Match Analytics, Home, and Revenue Breakdown before adding new styles. On mobile, preserve vertical scrolling, safe areas, reachable touch targets, and the existing bottom-sheet patterns. Keep chart bars subdued and lines clear, with correctly labelled axes and mock data explicitly identified. Inspect the current source because tokens and component breakpoints are not completely centralized.
