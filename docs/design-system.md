# Frontend Design System

**Overview:** A brutally minimal, dark-only design system for the Screen Time app. Emphasizes clarity, data visibility, and effortless navigation with zero visual noise. Purple/pink accents signal action and insight. Every element earns its place.

---

## Color Palette

### Dark Mode Only

- **Background:** `#0A0A0A` (Near black — main surface)
- **Surface Elevations:**
  - Level 1 (Cards, panels): `#1A1A1E` (Dark gray)
  - Level 2 (Modals, sheets): `#2C2C2E` (Lighter dark gray)
- **Text:**
  - Primary (Body): `#F5F5F7` (Off-white — maximum contrast)
  - Secondary (Hints, labels): `#A1A1A6` (Medium gray)
  - Tertiary (Disabled, subtle): `#636366` (Dark gray)
- **Dividers & Borders:** `#424245` (Dark border gray, use sparingly)

### Accent Colors (Purple/Pink)

- **Primary Accent:** `#E56FD9` (Vibrant magenta-pink)
  - Use for: Buttons, interactive elements, key metrics, highlights
  - Communicates: Action, insight, user interaction
- **Secondary Accent:** `#B388EB` (Soft purple)
  - Use for: Secondary CTAs, positive trends, supporting elements
  - Communicates: Support, secondary action
- **Muted Accent:** `#7D5DB2` (Deep purple)
  - Use for: Disabled states, less important secondary elements
  - Communicates: Inactive, lower priority

### Status & Data Colors

- **Success/Positive Trend:** `#34C759` (Green)
- **Warning/Alert:** `#FF9500` (Orange)
- **Destructive/High Usage:** `#FF3B30` (Red)
- **Neutral Data:** `#8E8E93` (Gray)

### Usage Rules

- **Minimize color:** Grayscale content, purple/pink for action only
- **Accent restraint:** Use primary accent for interactive elements; everything else is gray or white
- **Data colors:** Status colors always paired with icons/text — never color-only
- **No visual noise:** No gradients, no shadows, no borders unless necessary for separation

---

## Typography

### Font Family

- **Primary:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  - Follows iOS system font stack for native feel
  - Falls back gracefully on all platforms

### Type Scale

| Use Case               | Size | Weight         | Line Height | Letter Spacing |
| ---------------------- | ---- | -------------- | ----------- | -------------- |
| Page Title             | 28px | 700 (Bold)     | 32px        | -0.5px         |
| Section Header         | 20px | 600 (Semibold) | 24px        | -0.3px         |
| Card Title / List Item | 16px | 600 (Semibold) | 20px        | 0px            |
| Body Text              | 14px | 400 (Regular)  | 20px        | 0px            |
| Small Label / Caption  | 12px | 500 (Medium)   | 16px        | 0.2px          |
| Tiny / Timestamp       | 11px | 400 (Regular)  | 14px        | 0.2px          |
| Numeric Data (Large)   | 32px | 700 (Bold)     | 36px        | -1px           |
| Numeric Data (Small)   | 18px | 600 (Semibold) | 22px        | -0.5px         |

### Text Hierarchy Rules

1. **Body text is always 14px** — improves readability on mobile
2. **Titles scale down on small screens** — max 20px on iPhone SE / small devices
3. **High-contrast on white/dark backgrounds** — no light text on light; ensure WCAG AA minimum
4. **Numbers are slightly larger than labels** — makes data immediately scannable

---

## Spacing & Layout

### Spacing Scale

```
xs: 4px    — Icon padding, tight spacing
sm: 8px    — Card padding, list gaps
md: 16px   — Standard padding, section gaps
lg: 24px   — Major section breaks, screen margins
xl: 32px   — Top-level padding, wide sections
```

### Layout Principles

- **Screen Margins:** 16px (md) on all sides for comfortable reading
- **Vertical Rhythm:** Multiples of 8px for consistent spacing (4, 8, 12, 16, 24, 32)
- **Card Spacing:** 16px padding inside; 12px gap between cards
- **Safe Area:** Respect iOS safe area insets (notch, home indicator)
- **Max Content Width:** 600px for web/large screens (centered with margins)

### Responsive Behavior

- **Mobile (< 480px):** Single column, 16px margins
- **Tablet (480px - 768px):** Two columns or wider single column, 24px margins
- **Desktop (> 768px):** Two-column grid, centered max-width, 32px margins

---

## Components & Patterns

### Cards & Data Display

- **Card Structure:**
  - 16px padding, 8px border-radius
  - Background: `#1A1A1E`
  - Border: Optional 1px `#424245` (only when separation needed)
  - No shadows — flat, minimal aesthetic
- **List Items:** 12px vertical gap, no external padding (inset within card)

### Buttons

- **Primary Button (Purple/Pink Accent):**
  - Background: `#E56FD9`
  - Text: White, 14px semibold
  - Padding: 12px 20px, border-radius 8px
  - No border
  - Tap feedback: 75% opacity on active state
- **Secondary Button (Subtle Purple):**
  - Background: Transparent, border: 1px `#7D5DB2`
  - Text: `#B388EB`, 14px semibold
  - Same padding & border-radius
- **Minimal Button (Text-only):**
  - Text: `#E56FD9`, 14px medium
  - No background, no border
  - Tap feedback: 75% opacity

### Input Fields

- **Border:** 1px `#424245`
- **Padding:** 12px (vertical), 12px (horizontal)
- **Border-radius:** 8px
- **Focus State:** Purple accent border (2px `#E56FD9`), subtle background highlight
- **Label:** 12px, medium weight, 8px above field, secondary gray text

### Navigation & Structure

- **Tab Navigation:**
  - Bottom tabs (iOS convention) for mobile
  - Top nav or sidebar for web
  - Active indicator: Underline (2px `#E56FD9`) on tab
  - Labels: 12px, secondary gray (inactive), white (active)
- **Screen Transitions:** Fade only, no animation or bounce — instant feel preferred

---

## Data Visualization

### Chart Design

- **Color Mapping:**
  - **High usage:** Red (`#FF3B30`)
  - **Medium usage:** Orange (`#FF9500`)
  - **Low usage:** Green (`#34C759`)
  - **Neutral/Target:** Purple (`#E56FD9`)
- **Grid Lines:** Very subtle (`#424245` at 15% opacity) — use sparingly
- **Labels:** 11px tiny text, secondary gray
- **Y-axis:** Show only essential values (max 3-4 ticks)

### Metric Cards

- **Number:** Large (32px bold)
- **Label:** 12px secondary text below
- **Trend Indicator:** Small arrow or percentage with green/red color
- **Sparkline (Optional):** Tiny chart (60px width) showing 7-day trend

---

## Information Hierarchy & Density

### Principle: Show Data First, Navigation Second

1. **Above the fold:** Primary metric (total screen time) + key stats
2. **Below:** Detailed breakdown by app
3. **Settings:** Tucked away in tab bar or settings screen
4. **Radical minimalism:**
   - **No decorative elements** — no icons, illustrations, or graphics
   - **No animations** — only static content or instant transitions
   - **Silence is data:** Whitespace is intentional; empty space has meaning
   - **Every pixel serves function** — remove anything purely decorative

### Card Compression Strategy

- **Default view:** 3-4 apps per screen on mobile
- **Compact view:** Minimize padding to fit more items
- **Expandable details:** Tap to see breakdown; don't show everything at once
- **No secondary UI:** No tooltips, popovers, or overlays — content is explicit

---

## Minimalism Principles

**This is a data-focused app. Design must get out of the way.**

- **No skeuomorphism** — Flat surfaces, clear hierarchy, no 3D effects
- **No decorative colors** — Purple/pink for CTAs only; everything else is gray or white
- **No motion except necessity** — Static layouts, instant transitions, no micro-interactions
- **No icons unless critical** — Labels are clearer than symbols (especially for unfamiliar features)
- **Content density over whitespace** — But never cramped; use padding for breathing room
- **Ruthless hierarchy** — Only show what the user needs right now
- **Dark as default** — OLED screens benefit from pure black; minimizes visual clutter

---

## Dark Mode (Only Mode)

- **Implementation:** Hardcoded dark theme — no system toggle
- **OLED optimization:** Use `#0A0A0A` (pure black) for maximum contrast on modern screens
- **Status bars:** Light text (automatic on iOS with dark background)
- **Vibrancy (optional):** Consider slight transparency on card backgrounds for system integration

---

## Accessibility

### Color Contrast

- **AA Standard (Minimum):** 4.5:1 for text, 3:1 for UI components
- **AAA (Target):** 7:1 for body text
- **Status colors:** Supplement with icons/text — don't rely on color alone

### Touch Targets

- **Minimum:** 44px × 44px (iOS standard)
- **Actual buttons:** 48px × 48px preferred
- **Spacing:** 8px minimum between interactive elements

### Font Sizes

- **Body text:** Never smaller than 14px
- **Disabled state:** Use opacity (not just color) so still readable

### Motion

- **Reduce motion setting:** Respect `prefers-reduced-motion` — remove animations for users who opt-in
- **Avoid:** Rapid flashing, autoplay animations

---

## Implementation Checklist

- [ ] Set up color tokens/variables in design system (CSS, Tailwind, or theme provider)
- [ ] Define breakpoints for responsive behavior (480px, 768px)
- [ ] Create reusable component library (Button, Card, Input, etc.)
- [ ] Test dark mode on iOS device or simulator
- [ ] Verify all text meets WCAG AA contrast minimums
- [ ] Validate touch targets are 44px+ on all interactive elements
- [ ] Establish naming conventions (e.g., `color-primary`, `spacing-md`)
- [ ] Document any deviations from this guide for future reference

---

## Design Tokens (CSS Custom Properties Reference)

```css
/* Colors — Dark Mode Only */
--color-bg: #0A0A0A;
--color-surface-1: #1A1A1E;
--color-surface-2: #2C2C2E;
--color-text-primary: #F5F5F7;
--color-text-secondary: #A1A1A6;
--color-text-tertiary: #636366;
--color-border: #424245;

--color-accent-primary: #E56FD9;     /* Purple/Pink */
--color-accent-secondary: #B388EB;   /* Soft Purple */
--color-accent-muted: #7D5DB2;       /* Deep Purple */

--color-status-success: #34C759;
--color-status-warning: #FF9500;
--color-status-destructive: #FF3B30;
--color-status-neutral: #8E8E93;

/* Spacing */
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;

/* Type Scale */
--font-size-tiny: 11px;
--font-size-small: 12px;
--font-size-body: 14px;
--font-size-title: 16px;
--font-size-section: 20px;
--font-size-page: 28px;
--font-size-numeric-large: 32px;
--font-size-numeric-small: 18px;
```

---

## References

- **iOS Design System:** [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/)
- **Contrast Checker:** [WebAIM](https://webaim.org/resources/contrastchecker/)
- **Color Palette Inspiration:** Minimal data apps (Stocks, Weather, Health)
