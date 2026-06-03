# Chicken Road — UI Redesign Proposal

**Date:** 2026-06-03
**Status:** ✅ IMPLEMENTED — user delegated the pick; **Direction A (Side-scroller Crosswalk)** was
chosen, built into `src/pages/casino/ChickenRoadGame.jsx` (presentation-only; same `chicken_*` RPC
loop and odds), smoke-tested headlessly (win + death paths, 92/92 casino tests), and deployed to
cp-studios-pi.vercel.app on 2026-06-03. Mockups B/C remain here as alternate skins.
**Scope:** Visual + interaction redesign of `src/pages/casino/ChickenRoadGame.jsx`. Game math,
RPCs, and the server-side outcome model stay exactly as they are — this is a front-end reskin
of the same `chicken_open` / `chicken_step` / `chicken_cashout` loop.

---

## 1. Why the current UI is bad

The current screen renders the game as **7 thin 56px horizontal strips stacked vertically**,
with the chicken climbing bottom→top. Concretely:

| Problem | Detail |
|---|---|
| **Wrong metaphor** | A chicken-*crossing* game should read as *crossing*. Stacked bars read as a debug/spreadsheet view, not a road. |
| **Tiny & cramped** | `max-w-sm` board, 56px lanes, a 26px emoji chicken. No stage presence. |
| **Emoji art** | 🐔 🚗 💥 🪦 🪙 render differently per device, look cheap, and have no shared art style. The repo's own Aviator (`FlightBoard.jsx`) proves we can do cohesive custom SVG. |
| **No focal multiplier** | The number is the emotional engine of every cash-out game. Aviator has a 52px glowing Playfair multiplier; Chicken Road buries multipliers as 11px gray labels on the right edge of each strip. |
| **Danger isn't visualized** | Cars loop on infinite CSS animations *decoupled* from the outcome. A "Cross" is a 350ms pause → hop up or a 💥 appears. The chicken never visibly dodges or gets hit by a *specific* car, so there's no tension and no "near miss." |
| **Flat feedback** | Win = small green banner. Death = grayscale filter + 🪦. No juice, no payoff moment. |
| **Minor bug** | The Cash Out button uses `Cash Out\n{amount}` — the `\n` does nothing in HTML, so the amount runs onto one line. |

**Net:** it doesn't look or feel like a game. The redesign has to (a) pick a real spatial
metaphor for crossing, (b) make the multiplier the dramatic focal point, (c) actually *show* the
danger and the hit, and (d) replace emoji with cohesive CSS/SVG art in the CP palette.

## 2. What all three directions fix (shared principles)

- **A big, glowing, Playfair multiplier** as the focal point — grows/intensifies as you climb.
- **Cohesive CSS/SVG art** (chicken + cars drawn, not emoji) in the warm-dark CP palette.
- **Danger you can see** — a *specific* car hits the chicken on a failed step (squash, feather
  burst, screen shake), instead of an instant gravestone.
- **A real cash-out payoff** — coin burst + count-up of winnings.
- **Same math, same RPC loop, same odds.** Multipliers `[1.3, 2.0, 3.2, 4.8, 7.2, 11.0, 18.0]`,
  safe-probs `[0.72 … 0.25]`. Mobile-first, fits the existing `GameLayout` chrome.

## 3. The three directions

Each is a **fully interactive mockup** in this folder — open the `.html` in a browser and play it.

### Direction A — Side-scroller Crosswalk  ·  `mockup-a-sidescroller.html`  ·  ★ recommended
The genre standard (à la the Spribe/Inout "Chicken Road" crash game). **Horizontal**: chicken on
the left sidewalk, lanes extend right, traffic pours *down* each lane across the chicken's path.
Hop one lane right per step; the road scrolls to follow. Big Playfair multiplier pinned top-center
goes white-hot as it climbs. Death = the nearest car accelerates into the chicken (squash +
feathers + shake).

- **Why it wins:** matches what players expect from the real game; gives the cleanest "one more
  lane?" tension loop; the most natural home for the dramatic multiplier; reads instantly as
  *crossing a road*.
- **Trade-off:** the biggest departure from the current vertical layout (but the layout is the
  problem, so that's the point). Camera-follow scroll is the main new mechanic to build.
- **Effort:** Medium.

### Direction B — Vertical Perspective Ascent  ·  `mockup-b-vertical-ascent.html`
Keeps the **vertical** model (curb at the bottom → 18× jackpot at the top) but makes it cinematic:
the highway recedes upward into a hazy vanishing point, lanes are perspective trapezoids that
shrink with distance, the chicken stays centered while the world scrolls down past it. The
multiplier heats gold → orange → red as you ascend.

- **Why pick it:** smallest conceptual change from today's code (still "climb the lanes"), but a
  massive depth/drama upgrade over flat strips. Lowest logic risk.
- **Trade-off:** vertical crossing is slightly less intuitive than horizontal; the perspective math
  is the fiddly part (the mockup hit — and fixed — a real CSS 3D flattening bug doing camera-follow).
- **Effort:** Low–Medium.

### Direction C — Crossy Road Isometric  ·  `mockup-c-crossy-isometric.html`
The literal "Crossy Road" homage you named: a bright 2.5D **isometric voxel** mini-world — chunky
blocky chicken, blocky cars, grass curbs and asphalt rows receding in iso perspective, floating
multiplier coins over each lane. A joyful toy-world framed inside the dark premium casino chrome.
Death = classic flat squash; cash-out = coin fountain.

- **Why pick it:** maximum charm and brand identity; the most "fun" and most differentiated from
  every other game in the casino; strongest tie to the name you used.
- **Trade-off:** most art-heavy (isometric CSS transforms), highest build cost, and the tonal shift
  (playful board vs. the app's moody casino theme) is a deliberate bet that needs to land.
- **Effort:** Medium–High.

## 4. Recommendation

**Direction A (Side-scroller Crosswalk).** It's the strongest fix for the core problem (the wrong
metaphor), it's what players intuitively expect a chicken-crossing game to look like, and it gives
the multiplier and the "do I cross one more lane?" decision the most dramatic stage — at moderate
build cost. **C** is the right pick if we want maximum delight and to lean hard into the Crossy Road
brand; **B** is the safe, lowest-risk upgrade if we want to keep the current vertical logic.

A viable hybrid: ship **A** now, keep **C**'s blocky character art as a later skin.

## 5. How to review

Open each file in a browser (double-click, or drag into a tab) and play a few rounds —
bet, step/hop, cash out, and let one die:

```
docs/superpowers/specs/chicken-road-redesign/mockup-a-sidescroller.html
docs/superpowers/specs/chicken-road-redesign/mockup-b-vertical-ascent.html
docs/superpowers/specs/chicken-road-redesign/mockup-c-crossy-isometric.html
```

All three are self-contained (vanilla JS + inline CSS, only Google Fonts loaded), run the real
odds, and open straight from `file://`.

## 6. Next step

Pick a direction (or a hybrid). Then I'll turn it into a concrete implementation plan
(`writing-plans`) and build it into `ChickenRoadGame.jsx` — reusing the existing
`GameLayout`/`BetChips`/`ResultBanner` shared components and the unchanged `chicken_*` RPC loop, so
only the presentation layer changes.

> Note: these mockups + this doc are uncommitted, and the current branch is
> `fix/war-server-authoritative` (unrelated war work). I left them uncommitted on purpose — say the
> word and I'll move them onto their own branch.
