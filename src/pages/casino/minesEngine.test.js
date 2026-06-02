import test from 'node:test'
import assert from 'node:assert/strict'
import { minesMult, buildMines } from './minesEngine.js'

test('mult is 1 with zero revealed', () => {
  assert.equal(minesMult(0, 3), 1)
})

test('mult rises with reveals, 2-decimal rounded, >=1.01', () => {
  const m1 = minesMult(1, 3)
  assert.ok(m1 >= 1.01)
  assert.equal(m1, Math.round(m1 * 100) / 100)
})

test('mult matches MinesGame.jsx getMult formula exactly', () => {
  // Replicate getMult inline and compare across the full revealed range for each
  // mine count selectable in the UI (1,3,5,7,10).
  const getMult = (revealed, mines) => {
    let m = 1.0
    for (let i = 0; i < revealed; i++) m *= (25 - i) / (25 - mines - i)
    return +Math.max(1.01, m * 0.95).toFixed(2)
  }
  for (const mines of [1, 3, 5, 7, 10]) {
    const safeTiles = 25 - mines
    for (let revealed = 1; revealed <= safeTiles; revealed++) {
      assert.equal(minesMult(revealed, mines), getMult(revealed, mines),
        `mismatch at revealed=${revealed}, mines=${mines}`)
    }
  }
})

test('mult is floored at 1.01', () => {
  // A single safe reveal with 1 mine: m = 24/24 * 0.95 = 0.95 -> floored to 1.01.
  assert.equal(minesMult(1, 1), 1.01)
})

test('buildMines returns N distinct cells in 0..24', () => {
  const cells = buildMines(5, () => 0.5)
  assert.equal(new Set(cells).size, 5)
  assert.ok(cells.every((c) => c >= 0 && c < 25))
})

test('buildMines returns the exact requested count for each UI mine option', () => {
  let seed = 0
  // Cycling rng so distinct cells actually get drawn (a constant rng would loop).
  const rng = () => {
    seed = (seed + 0.137) % 1
    return seed
  }
  for (const count of [1, 3, 5, 7, 10]) {
    const cells = buildMines(count, rng)
    assert.equal(cells.length, count)
    assert.equal(new Set(cells).size, count)
    assert.ok(cells.every((c) => Number.isInteger(c) && c >= 0 && c < 25))
  }
})

test('buildMines defaults to global PRNG when no rng passed', () => {
  const cells = buildMines(3)
  assert.equal(new Set(cells).size, 3)
  assert.ok(cells.every((c) => c >= 0 && c < 25))
})
