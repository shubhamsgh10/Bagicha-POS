---
name: responsive-design
description: >
  Full-spectrum responsive design for React/Next.js + Tailwind + shadcn/ui.
  Handles both FIX MODE (audit + repair existing UI) and BUILD MODE (new pages, mobile-first from scratch).
  Trigger whenever the user mentions: mobile layout, broken on phone, responsive design, "fix the UI",
  "make it mobile-friendly", horizontal scroll, touch targets, bottom nav, sidebar, converting tables to cards,
  building a new page/component/dashboard, UI improvements, design systems, breakpoints, or Tailwind patterns.
  Also trigger when the user shares a component and asks for improvements — even without specifying mobile.
  When in doubt, trigger. Responsive design is almost always relevant to frontend work.
---

# Responsive Design Skill

Full-spectrum skill for building and fixing responsive interfaces in React 18 + TypeScript + Tailwind + shadcn/ui.

Two modes:
- **FIX MODE** — auditing and repairing an existing UI
- **BUILD MODE** — building a new page or component, mobile-first from line one

Determine the mode from context. If the user shares existing code → FIX. If they want something new → BUILD. When unclear, ask one question.

---

## Breakpoint Reference (always use these — never invent custom ones)

| Prefix | Min-width | Target |
|--------|-----------|--------|
| *(none)* | 0px | Mobile (320–428px) — design here first |
| `sm:` | 640px | Large phones / small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |
| `2xl:` | 1536px | Wide screens |

**Rule**: Every class without a prefix applies to mobile first. `sm:` and above override upward.

---

## FIX MODE — Audit → Plan → Apply → Verify

### Phase 1 — Audit First (never skip)

```bash
# Locate all pages and components
find app -name "page.tsx" -type f
find src -name "*.tsx" -type f 2>/dev/null
find components -name "*.tsx" -type f 2>/dev/null
```

For each file, check against this audit checklist and mark pass/fail:

```
LAYOUT
  □ Container uses responsive padding: px-4 sm:px-6 lg:px-8
  □ No fixed px widths that break at 320–428px
  □ Max-width container with mx-auto on all major sections
  □ Grids collapse to 1 col on mobile: grid-cols-1 sm:grid-cols-2 lg:grid-cols-N
  □ Sidebars are collapsible or off-canvas on mobile

NAVIGATION
  □ Desktop nav hidden on mobile: hidden md:flex
  □ Mobile nav exists: hamburger drawer OR bottom tab bar
  □ Active state visible on mobile nav

TYPOGRAPHY
  □ H1 scales: text-2xl sm:text-3xl lg:text-4xl
  □ H2 scales: text-xl sm:text-2xl
  □ Body minimum text-base (16px) — never text-sm for primary content
  □ Long text lines capped: max-w-prose or max-w-2xl

INTERACTIVE ELEMENTS
  □ Touch targets ≥ 44×44px: min-h-[44px] min-w-[44px]
  □ touch-manipulation on all interactive elements
  □ Buttons stack on mobile: flex-col sm:flex-row
  □ Form inputs full-width on mobile: w-full sm:w-auto

TABLES
  □ Tables have overflow-x-auto wrapper on mobile
  □ Complex tables converted to cards on mobile (md:hidden / hidden md:block)

MODALS & DIALOGS
  □ Full-width with margin: w-full max-w-[600px] mx-4 sm:mx-auto
  □ Max height + scroll: max-h-[90vh] overflow-y-auto

IMAGES & MEDIA
  □ No fixed width that overflows container
  □ max-w-full h-auto on all <img> elements
  □ Next.js Image uses sizes prop

SPACING & OVERFLOW
  □ No horizontal overflow (check for overflow-x-hidden on html/body)
  □ Main content padded for bottom nav: pb-20 md:pb-0
  □ Sticky header accounts for content: pt-[header-height]
```

Report format — be explicit:
```
[FILE]: app/dashboard/page.tsx
  ✗ Grid locked at grid-cols-4 — no mobile breakpoints
  ✗ Table not wrapped in overflow-x-auto
  ✗ Buttons not stacking (flex gap-2 with no flex-col)
  ✓ Container padding is responsive
  ✗ Touch targets too small on action icons
```

Present the full audit report and confirm the fix plan before writing any code.

### Phase 2 — Fix Patterns

See `references/patterns.md` for full before/after code for every pattern.

| Issue Found | Pattern to Apply |
|-------------|-----------------|
| Fixed grid columns | Grid Pattern |
| Desktop-only nav | Header + Bottom Nav Pattern |
| Table overflowing | Table → Card Pattern |
| Fixed-width form row | Form Pattern |
| Side-by-side buttons | Button Group Pattern |
| Sidebar blocking mobile | Sidebar Pattern |
| Fixed-width modal/dialog | Modal Pattern |
| Oversized headings | Typography Pattern |
| Breaking images | Image Pattern |
| Horizontal scroll | Overflow Debug |

### Phase 3 — Apply (surgical edits only)

Order of operations:
1. Layout containers first (padding, max-width)
2. Navigation (hide desktop nav, add mobile nav/bottom bar)
3. Grids and flex layouts
4. Tables → cards
5. Forms and inputs
6. Modals and dialogs
7. Typography scaling
8. Touch target sizing

Rules:
- Only change what the audit flagged — do not rewrite working code
- Preserve all existing logic, state, and functionality
- Add responsive classes alongside existing ones — don't replace the whole className
- Mental-test every change at 320px, 375px, 428px before moving on

### Phase 4 — Verify Report

After all changes, produce a verification summary:

```
CHANGES APPLIED
  app/dashboard/page.tsx
    ✓ Grid: grid-cols-4 → grid-cols-1 sm:grid-cols-2 lg:grid-cols-4
    ✓ Table → card pattern applied (hidden md:block / md:hidden)
    ✓ Buttons: flex gap-2 → flex flex-col sm:flex-row gap-2
    ✓ Touch targets: all action icons now min-h-[44px] min-w-[44px]

  app/layout.tsx
    ✓ Bottom nav added (md:hidden, fixed bottom-0)
    ✓ Desktop nav: hidden md:flex
    ✓ Main: pb-20 md:pb-0 added
```

---

## BUILD MODE — Mobile-First from Line One

When building new pages or components, never start from desktop and scale down. Always:

1. **Design the 320px layout first** — what's the most stripped-back version?
2. **Add complexity upward** — use sm:, md:, lg: to progressively enhance
3. **Pick a design direction before writing code** — see Design Direction section below

### Design Direction (required for new builds)

Before writing a single line, commit to one of these directions. Don't blend — pick one and execute it fully:

| Direction | Characteristics | When to use |
|-----------|----------------|-------------|
| **Refined Minimal** | Generous whitespace, sharp typography, single accent color, subtle borders | Dashboards, admin panels, SaaS apps |
| **Data Dense** | Compact spacing, tabular layouts, monospace data, high information density | POS systems, analytics, ops tools |
| **Warm Commercial** | Rounded corners, friendly colors, card-heavy, illustrated empty states | Consumer apps, restaurants, retail |
| **Editorial** | Large type, asymmetric layout, bold photography, magazine-like hierarchy | Landing pages, portfolios |
| **Utility First** | Zero decoration, pure function, system fonts, maximum contrast | Internal tools, dev tools |

For Bagicha POS → use **Data Dense** or **Warm Commercial** depending on the surface (ops vs customer-facing).

### New Page Scaffold

Read `references/templates.md` for full copy-paste templates. Always start from the Full Page Template — never from a blank div.

Key scaffold rules:
- Wrap all pages in `min-h-screen bg-background`
- All sticky headers: `sticky top-0 z-40 bg-background/95 backdrop-blur border-b`
- All main content: `px-4 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 md:pb-6`
- All section containers: `max-w-7xl mx-auto`
- Always include bottom nav placeholder for mobile

### Component Hierarchy for New Builds

```
Page
└── Layout (sticky header + bottom nav shell)
    └── Main (responsive padding + max-width)
        ├── Page Header (title + primary action)
        ├── Filters / Search Bar (responsive form)
        ├── Content Section
        │   ├── Desktop: Table or Grid
        │   └── Mobile: Cards or List
        └── Modals / Drawers (triggered from above)
```

---

## Design System Tokens (Tailwind + shadcn/ui)

Use these consistently — never hardcode colors or spacing values:

```tsx
// Colors — always use semantic tokens, not raw colors
bg-background        text-foreground
bg-card              text-card-foreground
bg-muted             text-muted-foreground
bg-primary           text-primary-foreground
border-border        ring-ring

// Spacing scale — stick to this
gap-3 sm:gap-4 lg:gap-6     (cards, grid gaps)
p-4 sm:p-6                  (card internal padding)
px-4 sm:px-6 lg:px-8        (page horizontal padding)
py-4 sm:py-6                (page vertical padding)
space-y-4 sm:space-y-6      (vertical stacking)

// Border radius — use shadcn conventions
rounded-lg       (cards, containers)
rounded-md       (buttons, inputs)
rounded-full     (avatars, badges, pills)

// Shadow — use sparingly
shadow-sm        (cards on white bg)
shadow-md        (modals, dropdowns)
```

---

## Common Debug Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Horizontal scroll on mobile | Fixed-width element | `overflow-x-hidden` on parent + fix the element |
| Bottom nav overlapping content | Missing padding | `pb-20 md:pb-0` on `<main>` |
| Sticky header cutting content | Missing top padding | `pt-[var(--header-height)]` on main |
| Touch targets too small | No min-size set | `min-h-[44px] min-w-[44px]` on all interactive elements |
| Text too small on mobile | `text-sm` on primary content | Upgrade to `text-base` minimum |
| Image breaking layout | Fixed width | `max-w-full h-auto` or Next.js `fill` with sized wrapper |
| Dialog too wide on mobile | Fixed `w-[Npx]` | `w-full max-w-[Npx] mx-4 sm:mx-auto` |
| Double-tap zoom on buttons | Missing touch-action | `touch-manipulation` class on buttons/inputs |
| Inputs zoom on iOS | Font size < 16px | Ensure `text-base` (16px) minimum on all `<input>` |

---

## Reference Files

- `references/patterns.md` — Full before/after code for all 10 responsive patterns. **Read before writing any pattern code.**
- `references/templates.md` — Copy-paste page templates, data list components, and utility class reference for new builds.
