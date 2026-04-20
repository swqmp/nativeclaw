---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

## Animation & Polish (Vanilla CSS/JS)

The invisible details that make a site feel professional vs amateur. These are CSS-only patterns that work without frameworks.

### The Animation Decision Framework

Not everything should animate. Decide based on how often the interaction happens:

| Frequency | Rule | Example |
|-----------|------|---------|
| 100+ times/day | No animation | Typing, scrolling, toggling |
| Occasional | Standard transition | Opening menus, tab switches |
| Rare / first-time | Add delight | Page load, form submission success |

**Purpose check:** Every animation must do one of these: show spatial relationship, indicate state change, explain a transition, give feedback, or prevent a jarring change. If it does none, remove it.

### Duration & Easing Cheat Sheet

| Element | Duration | Easing |
|---------|----------|--------|
| Button press / hover | 100-160ms | `ease` or `cubic-bezier(0.2, 0, 0.2, 1)` |
| Tooltips | 125-200ms | `ease-out` |
| Dropdowns / menus | 150-250ms | `ease-out` |
| Modals / overlays | 200-400ms | `ease-out` for enter, `ease-in` for exit |
| Page section reveals | 300-500ms | `ease-out` or `cubic-bezier(0.16, 1, 0.3, 1)` |

**Hard rule:** Stay under 300ms for any UI response to user input. Anything slower feels sluggish.

**Easing rules:**
- `ease-out` for elements entering (fast start, gentle landing)
- `ease-in-out` for elements moving position
- `ease` for hover/active state changes
- **Never** use `ease-in` alone for UI — it feels slow and unresponsive
- Prefer custom `cubic-bezier()` over generic keywords for polished feel

### Interactive Element Polish

```css
/* Button press feedback — scale down slightly on click */
button, .btn, [role="button"] {
  transition: transform 120ms ease, background-color 150ms ease;
}
button:active {
  transform: scale(0.97);
}

/* Hover states — only on devices that support hover */
@media (hover: hover) and (pointer: fine) {
  button:hover {
    /* your hover styles here */
  }
}
```

**Why the media query matters:** Without `@media (hover: hover)`, mobile users get "sticky" hover states that linger after tapping. This is the #1 source of weird mobile button behavior on client sites.

### Stagger Animations

For page loads or section reveals, stagger child elements with 30-80ms delays:

```css
.stagger-in > * {
  opacity: 0;
  transform: translateY(12px);
  animation: fadeUp 400ms ease-out forwards;
}
.stagger-in > *:nth-child(1) { animation-delay: 0ms; }
.stagger-in > *:nth-child(2) { animation-delay: 50ms; }
.stagger-in > *:nth-child(3) { animation-delay: 100ms; }
.stagger-in > *:nth-child(4) { animation-delay: 150ms; }
.stagger-in > *:nth-child(5) { animation-delay: 200ms; }

@keyframes fadeUp {
  to { opacity: 1; transform: translateY(0); }
}
```

One well-orchestrated stagger on a hero section beats 20 scattered micro-interactions across the page.

### Performance Rules

- **Only animate `transform` and `opacity`.** These are GPU-composited and don't trigger layout/paint. Animating `width`, `height`, `margin`, `padding`, `top`, `left`, `border-radius`, or `box-shadow` causes jank.
- Use `will-change: transform` sparingly on elements that will animate (remove after animation completes if possible).
- Prefer CSS transitions over JS-driven animations. CSS transitions are interruptible and hardware-accelerated by default.
- `transition: all` is lazy and expensive. Always specify the exact properties: `transition: transform 150ms ease, opacity 150ms ease`.

### Reduced Motion Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Reduce motion, don't eliminate it. Users who enable this setting still need state changes to be visible, they just don't want things flying around. Instant transitions (near-zero duration) are fine.

### Pre-Ship Polish Checklist

Before calling a build done, check for these common issues:

| Issue | Fix |
|-------|-----|
| `transition: all` anywhere | Replace with specific properties |
| Hover styles with no media query | Wrap in `@media (hover: hover) and (pointer: fine)` |
| Any animation > 300ms on user input | Reduce duration |
| Elements animating from `scale(0)` | Start from `scale(0.95)` or `scale(0.97)` minimum |
| No `:active` state on buttons | Add `transform: scale(0.97)` |
| No `prefers-reduced-motion` handling | Add the reduced motion media query |
| Animating layout properties | Switch to `transform` and `opacity` only |
| Missing `transform-origin` on scaling elements | Set origin to match context (e.g. dropdown from top, tooltip from trigger) |
| Symmetric enter/exit timing | Exit should be ~70% of enter duration (faster out, slower in) |
