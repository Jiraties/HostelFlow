# HostelFlow Document Design System

Version 1.0 - 2 October 2026

Design guidance for PDFs, printable HTML, Word documents, and printable operational sheets. Based on the [HostelFlow UI Design System](hostelflow-design-system.md), adapted for fixed pages and paper.

This is a document specification. Recommended print measurements below are new guidance, not existing application tokens or a claim that every current export already follows them. It does not change the document generators, business calculations, or existing templates.

## 1. Visual direction

HostelFlow documents should feel calm, clear, and practical: white pages, dark readable text, restrained cyan branding, generous alignment, and a clear hierarchy.

- Keep the brand's typography and colour identity.
- Let content and figures carry the page rather than decorative containers.
- Use pale fills and thin rules to group information.
- Give totals, actions, and exceptions a clear visual position.
- Keep each document understandable when printed in black and white.
- Use compact branding on operational pages; reserve a larger title treatment for report covers.

### Translate the UI into paper

| UI pattern | Document equivalent |
| --- | --- |
| Floating white card | Aligned section with a pale fill or thin border |
| Card shadow | Whitespace, a rule, or a light outline; omit the shadow |
| Large rounded panel | Smaller corner radius, typically 2-3mm |
| Pill status chip | Small labelled status marker; readable without colour |
| Updated-at metadata | Generated-at timestamp and reporting period |
| Tooltip | Short note, caption, glossary entry, or footnote |
| Scrollable table | Repeated table headers across pages or a landscape page |
| Hover interaction | Visible label, reference, or written instruction |
| Sidebar navigation | Contents list, section headings, or PDF bookmarks |
| Sticky controls | Clear final action/signature area; keep interactive controls outside print content |

## 2. Page format and grid

### Recommended defaults

| Setting | Document default |
| --- | --- |
| Page size | A4: 210 x 297mm |
| Orientation | Portrait; use landscape for genuinely wide tables |
| Standard margins | 18mm on all sides |
| Dense operational-sheet margins | 12-15mm, after checking printer clearance |
| Main layout | One content column |
| Optional secondary layout | Two aligned columns for short metadata or comparable summaries |
| Section spacing | 5-8mm |
| Internal panel padding | 3-5mm |
| Table cell padding | Around 2-3mm vertically and 2-3mm horizontally |
| Rules | Around 0.5pt; avoid hairlines that disappear in print |
| Corners | Usually 2-3mm; square corners are suitable for dense tables |

Use millimetres for page geometry and points for text. Do not directly reuse viewport units, `rem` values, mobile breakpoints, or screen card dimensions.

Keep a stable left edge for headings, tables, and body text. Use a consistent right edge for aligned amounts. Reserve space for page headers and footers before laying out the body.

The existing Booking Summary already outputs A4 portrait pages. Its current internal canvas and margin measurements differ from these recommended defaults; preserve its working pagination until a document-specific revision is explicitly requested.

## 3. Document colour palette

Reuse the brand colours, with darker text and more restrained surface treatments for print. Several values below already appear in the Booking Summary renderer.

| Role | Value | Use |
| --- | --- | --- |
| Brand cyan | `#51d1dc` | Logo accents, short rules, chart highlights |
| Pale cyan | `#eaf8f9` | Table headers and small summary surfaces |
| Main document text | `#182126` | Body text, values, headings |
| Supporting text | `#667077` | Metadata, captions, secondary labels |
| Divider / border | `#dce5e7` | Fine rules and table separators |
| Neutral surface | `#f6f6f6` | Quiet information groups and optional row shading |
| Positive accent | `#1ecb83` | Positive markers accompanied by a label or symbol |
| Brand red accent | `#fd4169` | Exception markers or status accents |
| Dark red | `#dc2626` | Readable error/negative emphasis; already used in Booking Summary |
| Page background | `#ffffff` | Main page surface |

### Print rules

- Prefer dark text on white or pale backgrounds.
- Do not use bright cyan or green for small explanatory text.
- Avoid large saturated fills and full-page coloured backgrounds.
- Keep text readable when a pale surface fill is not printed.
- A positive/negative marker needs wording, a sign, or an icon as well as colour.
- Use colour meanings consistently within the document; explain metric-specific meanings when needed.
- For monochrome output, retain the hierarchy through weight, alignment, rules, symbols, and labels.

## 4. Typography

Use **IBM Plex Sans Thai** for Thai and English. The current Booking Summary loads regular, medium, semibold, and bold weights.

### Recommended print scale

| Role | Size | Weight |
| --- | --- | --- |
| Report cover title | 24-28pt | Semibold |
| Document title | 18-22pt | Semibold |
| Major section heading | 12-14pt | Medium or semibold |
| Subheading | 10.5-11.5pt | Medium |
| Body / instructions | 10-11pt | Regular |
| Table body | 9-10pt | Regular |
| Table heading | 9-10pt | Medium |
| Captions / metadata | 8.5-9pt | Regular |
| Footer | 8-9pt | Regular |
| Summary figure | 18-24pt | Regular or medium |

- Start with body line spacing around 1.4-1.5; allow more room for Thai marks and mixed scripts where needed.
- Do not shrink entire pages to fit a table. Adjust columns, orientation, or pagination first.
- Keep headings short and avoid all-caps paragraphs.
- Use tabular numerals when the export engine supports them.
- Align decimals and numeric columns consistently.
- For text-based exports, embed or subset fonts and verify Thai shaping, marks, and glyph coverage.
- For browser printing, wait for the intended fonts before rendering.

The current Booking Summary renders pages to canvas images inside a PDF. That protects its rendered appearance but does not provide the same text selection or accessibility as a text-based PDF. This specification recommends selectable text for new document generators where practical; changing the existing renderer is separate work.

## 5. Header, footer, and document identity

### First page

Use a compact header with:

1. The approved HostelFlow logo, preserving its proportions.
2. A clear document title, such as Booking Summary or Monthly Report.
3. The relevant reporting period or stay dates.
4. A document reference and generated-at timestamp where useful.
5. Business identity/contact fields only when the document's purpose requires them.

The logo should support the content, not compete with the title. Avoid staff avatars, navigation elements, or button-like decoration in the printed header.

### Continuation pages

Repeat a shorter identity line: document title, essential reference, and period. Repeat table column headers. Do not repeat a large cover treatment on every page.

### Footer

- Show `Page X of Y` consistently.
- Use a short document identifier or version when useful.
- Keep footer text smaller than the body but readable.
- Include an audience/privacy label only where appropriate to the document.
- Use Bangkok time for business timestamps and make the timezone explicit where ambiguity matters.

## 6. Document components

### Metadata block

Use a small label/value grid for a reference, date range, status, or issuer. Keep labels muted and values dark. Align fields instead of enclosing every field in a separate card.

### Summary panel

Use a pale cyan or neutral surface, dark figures, and a short explanatory label. Keep equal metrics aligned. Limit the number of summary boxes so the document still reads as a page rather than a dashboard screenshot.

### Status marker

Use a short textual status with a small tint, outline, or symbol. It must remain identifiable in grayscale. Avoid interactive-looking status toggles.

### Notes and callouts

Place notes close to the content they explain. Use a slim side rule or pale surface with a concise label such as Note or หมายเหตุ. Separate a required action from ordinary explanatory copy.

### Totals block

Put totals directly after the relevant table. Align labels and amounts, distinguish subtotal from final total, and keep units explicit. Use a slightly stronger rule or weight for the final total, rather than a large coloured box.

### Signature or acknowledgement

Provide enough physical writing space, labels beneath the lines, and a date field if required. Keep the entire signature group on one page. Include signature fields only when the workflow needs them.

## 7. Tables and financial presentation

- Keep text columns left aligned and amounts right aligned.
- Use a consistent currency format within each table, including decimal precision.
- Put units in column headings where repeated units would clutter the rows.
- Keep missing values distinct from a confirmed zero.
- Show refund/adjustment signs explicitly; colour alone is insufficient.
- Use light horizontal rules rather than a heavy grid around every cell.
- Repeat headings after page breaks and keep ordinary rows together where possible.
- Group unusually long notes separately instead of making every row tall.
- Keep totals with the relevant final rows; never leave a total stranded on a separate page.
- Preserve authoritative calculations, monetary rounding, transaction meaning, and audit terminology. Styling changes must not redefine amounts.

If a table still cannot fit legibly, use landscape orientation or split it into clearly labelled related tables. Use a visible continuation label when a logical group spans multiple pages.

## 8. Charts and figures

- Use charts only when they help explain a comparison or trend.
- Provide a title, date range, legend, labelled units, and a short explanatory caption.
- Keep chart text readable at the final printed size.
- Use soft cyan bars and a stronger line where that matches the chart's meaning.
- For revenue plus occupancy, use separate currency and percentage axes and identify both series clearly.
- Make daily, cumulative, actual, and forward-looking figures distinguishable in wording.
- Use line styles, markers, or patterns when series would merge in grayscale.
- Printed charts cannot rely on hover tooltips; place essential values or explanations on the page.
- Prefer vector charts; render raster charts at sufficient resolution for their printed size, typically around 300dpi.
- Include the data period and source description, using synthetic data for design examples.

## 9. Language and audience

Document language follows the intended reader, rather than automatically copying the UI language.

| Document | Language approach |
| --- | --- |
| Guest Booking Summary | English by default; preserve the existing supported Thai version |
| Staff operational sheet | Thai instructions with familiar English hospitality terms |
| Management report | Consistent primary language; Thai supporting explanations and familiar English KPI names where appropriate |
| Bilingual handout | Paired headings or concise translations where the reader needs both |
| Formal/statutory template | Follow the required format and language before decorative brand styling |

Avoid translating the same paragraph twice unless the audience needs it. Keep English industry terms where they are clearer. Preserve source-explaining financial labels and use short Thai notes for supporting meaning.

## 10. Recommended document templates

### Guest Booking Summary

Compact brand header → booking/stay metadata → room/stay information → charge/payment tables → totals → guest notes → footer.

Use the existing Booking Summary as the starting point. Preserve its language options, current financial projections, and page continuation behaviour.

### Staff operational sheet

Compact title and business date → short task/exception summary → practical working table → notes or acknowledgement area → footer.

Prioritise writable space and scan speed. Include only the personal information necessary for the task; routine sheets should not include passport details.

### Management report

Title/period and short overview → key figures → charts and interpretation → supporting tables → definitions/source notes → footer.

A separate cover is optional. Use it for a substantial report, not for a one-page update.

### Form or checklist

Purpose and instructions → clearly grouped fields/checklist items → required acknowledgement/signature → reference/footer.

Use visible field boundaries and clear required/optional wording. Avoid decoration that reduces writing space. If the PDF is intended to be fillable, define actual interactive form fields rather than drawing empty boxes alone.

## 11. Pagination and output quality

- Keep a heading with its opening paragraph or first table row.
- Prevent clipped rows, orphaned captions, overlapping footers, and empty continuation pages.
- Repeat key identity and table headings on continuation pages.
- Verify both short and long content, including Thai text and long names.
- Check A4 printing at actual size, colour output, grayscale, and any intended duplex layout.
- For digital PDFs, prefer selectable text, document metadata, bookmarks for long reports, and tagging where the generator supports them. Do not claim accessibility compliance without checking it.
- Treat Word layouts separately from fixed PDFs: use styles, real tables, and controlled page breaks rather than positioning everything with spaces.

## 12. Safe examples and source references

Design-system examples must use placeholders such as `[Guest name]`, `[Document reference]`, `[Date range]`, and `[Amount]`. Do not copy real guest details, operational results, contact data, or production screenshots into design fixtures.

Actual generated documents must follow the repository's private-artifact handling rules. A public design guide should contain styling guidance and fabricated examples only.

References:

- [HostelFlow UI Design System](hostelflow-design-system.md): brand identity and current UI conventions.
- [index.css](../frontend/src/index.css): global colours and typography.
- [Booking Summary renderer](../frontend/src/features/bookings/bookingSummaryPdf.ts): existing A4 output, document palette, font loading, language options, tables, and continuation pages.

### Brief to paste into another chat

> Design HostelFlow documents with IBM Plex Sans Thai, white A4 pages, dark readable text, restrained cyan accents, pale section fills, and thin rules. Use print measurements in mm and pt. Start with 18mm margins, 10-11pt body text, 18-22pt titles, and 9-10pt tables, adjusting for the document's purpose. Replace UI shadows and floating controls with whitespace and clear page structure. Repeat table headers and compact identity on continuation pages; include page numbers, period, and relevant references. Make statuses and charts understandable in grayscale. Keep Thai explanations concise and retain familiar English hospitality terms. Guest Booking Summary defaults to English with Thai support retained. Preserve financial calculations and terminology. Use only fabricated examples, and render and inspect the final document before delivery.
