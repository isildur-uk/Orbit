# Orbit Personal Network — DESIGN.md

Binding design contract for every visual artifact in this project (app UI, docs,
diagrams, screenshots). Read it before producing UI; run the pre-ship checklist
before calling anything done.

**Preset: A — operational tool** (dense relationship graph + address book), executed
in an **editorial, Ferrari-inspired** register. Not a generic SaaS dashboard.

---

## PROJECT TOKENS

Source of truth is `src/personal-network/network.css` `:root`. Mirror, never fork.

**Colour**
- Canvas near-black `#181818` (with the diagonal charcoal→oxblood gradient `--network-gradient-canvas`)
- Panels `#303030` / `#242424`; hairlines `#303030` and `rgba(255,255,255,.14)`
- Text `#ffffff`; muted `#969696`; faint `#666666`
- **One accent — Rosso Corsa `#da291c`** (hover `#9d2211`, active `#b01e0a`). Nothing competes with it.
- Focus ring `#fff200` (high-contrast yellow), 2px, offset
- Semantic-only, used sparingly: organisation marker gold `#c9a24b` / `#e6c877`. **No mint/teal, no green success chrome, no blue or purple.**

**Type**
- One family: **Inter Var** (`--network-font`), the FerrariSans substitute. Weights 500/600/700.
- Display: 500 weight, tight tracking (`-.04em` to `-.055em`), large (`clamp` up to 74px on auth).
- Kickers/labels: 10–11px, `letter-spacing` ~1.1px, uppercase, muted.
- **Tabular numerals** on every metric/count (`font-variant-numeric:tabular-nums`).

**Geometry & depth**
- Sharp by default: `--network-radius:0px`. Exceptions: 4px on inputs, pill contact-chips, 18px top corners on mobile bottom-sheets.
- Restrained borders (1px hairlines) and restrained shadows (deep, low-opacity, e.g. `0 24px 80px rgba(0,0,0,.5)` on modals only).
- 8px spacing rhythm; generous panel padding (28–48px desktop).

**Motion**
- Fast, mechanical: 0.16–0.2s ease on colour/border/transform. Buttons press `translateY(1px)`.
- Honour `prefers-reduced-motion` (already globally disabled there).

---

## NON-NEGOTIABLES (apply even before reading tokens)

1. Never Inter/system-ui as a *substitute for a missing brand font by accident* — here Inter **is** the chosen brand face, used deliberately at display sizes. No other UI font.
2. Never blue→purple / indigo→violet gradients. The only gradients are charcoal→oxblood and the red action gradient.
3. Never emoji as UI icons. Icons are inline SVG (see the close glyph) or text.
4. No floating thin-border + wide-soft-shadow "AI cards". Surfaces are flat panels with hairlines; shadow is reserved for true overlays.
5. **One accent** (Rosso Corsa). Gold is a semantic organisation marker only.
6. 8px grid; tabular numerals for all data.
7. Every interactive control has rest / hover / active / focus / disabled / loading states.
8. Touch targets ≥ 44px on phone widths; no horizontal overflow at 360px.

---

## SURFACE RULES

- **People vs organisations** are visually distinct: organisations get a gold badge in the profile header and a square gold-bordered graph node; individuals are red/grey dots.
- **Provenance is always shown**: user-entered vs imported is labelled on every record; imports pass through the review screen before merge.
- **No dead controls**: every button gives visible feedback; unavailable providers show an explicit "needs setup" state, never a fake success.
- **Never a blank screen**: the boot gate shows a spinner then, on failure, an actionable reload — see `#boot-screen`.

---

## PRE-SHIP CHECKLIST

- [ ] Would someone instantly say "an AI made this"? If yes, stop and fix.
- [ ] Single accent held; no stray green/blue/purple; gold only on organisations.
- [ ] Tabular numerals on counts; kickers uppercase and tracked.
- [ ] All six button states present and visible; focus ring shows on keyboard nav.
- [ ] 360px wide: no horizontal scroll; tap targets ≥44px; bottom nav reachable.
- [ ] Loading, empty, and error states are all designed and helpful.
- [ ] Boot gate resolves to auth, workspace, or a recovery action — never blank.
