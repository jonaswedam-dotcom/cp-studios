import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SYMBOLS, REELS, ROWS, PAYLINES,
  drawSymbol, spinGrid, evaluateGrid, netForBet, theoreticalRTP,
} from './slotsEngine.js'

const CHERRY = 0, LEMON = 1, SEVEN = 2, STAR = 3, DIAMOND = 4
const gridOf = (rows) => rows.map((r) => [...r])

test('drawSymbol returns first symbol when rng is 0', () => {
  assert.equal(drawSymbol(() => 0), CHERRY)
})

test('drawSymbol lands in the correct weight bucket', () => {
  // cumulative weights (sum 20): cherry[0,6) lemon[6,12) seven[12,16) star[16,19) diamond[19,20)
  assert.equal(drawSymbol(() => 6 / 20), LEMON)
  assert.equal(drawSymbol(() => 19.5 / 20), DIAMOND)
})

test('spinGrid has ROWS×REELS valid symbol indices', () => {
  const grid = spinGrid(Math.random)
  assert.equal(grid.length, ROWS)
  for (const row of grid) {
    assert.equal(row.length, REELS)
    for (const s of row) assert.ok(s >= 0 && s < SYMBOLS.length)
  }
})

test('no win when nothing makes a 3-from-left run', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [CHERRY, LEMON, CHERRY, LEMON, CHERRY],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
    [SEVEN, STAR, SEVEN, STAR, SEVEN],
  ]))
  assert.equal(totalReturn, 0)
  assert.equal(lines.length, 0)
})

test('3-from-left seven on the middle row pays 3x', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [CHERRY, LEMON, CHERRY, LEMON, DIAMOND],
    [SEVEN, SEVEN, SEVEN, CHERRY, LEMON],
    [STAR, CHERRY, STAR, CHERRY, STAR],
  ]))
  assert.equal(totalReturn, 3)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].lineIndex, 1)
  assert.equal(lines[0].symbol, SEVEN)
  assert.equal(lines[0].runLength, 3)
  assert.equal(lines[0].multiplier, 3)
  assert.deepEqual(lines[0].cells, [[1, 0], [1, 1], [1, 2]])
})

test('a 2-from-left run does not count', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [STAR, STAR, CHERRY, STAR, STAR],
    [CHERRY, LEMON, SEVEN, STAR, DIAMOND],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
  ]))
  assert.equal(totalReturn, 0)
  assert.equal(lines.length, 0)
})

test('5-of-a-kind diamond pays the 300x jackpot', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [DIAMOND, DIAMOND, DIAMOND, DIAMOND, DIAMOND],
    [CHERRY, LEMON, SEVEN, STAR, CHERRY],
    [LEMON, CHERRY, LEMON, CHERRY, LEMON],
  ]))
  assert.equal(totalReturn, 300)
  assert.equal(lines[0].runLength, 5)
  assert.deepEqual(lines[0].cells, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]])
})

test('4-of-a-kind star on the top row pays 15x', () => {
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [STAR, STAR, STAR, STAR, CHERRY],
    [CHERRY, LEMON, SEVEN, CHERRY, LEMON],
    [LEMON, CHERRY, LEMON, SEVEN, CHERRY],
  ]))
  assert.equal(totalReturn, 15)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].lineIndex, 0)
  assert.equal(lines[0].runLength, 4)
  assert.equal(lines[0].multiplier, 15)
  assert.deepEqual(lines[0].cells, [[0, 0], [0, 1], [0, 2], [0, 3]])
})

test('the Λ diagonal line is evaluated', () => {
  // Λ path (2,0)(1,1)(0,2)(1,3)(2,4): 3 sevens on the first three cells
  const { lines } = evaluateGrid(gridOf([
    [CHERRY, LEMON, SEVEN, STAR, DIAMOND],
    [LEMON, SEVEN, CHERRY, LEMON, STAR],
    [SEVEN, CHERRY, LEMON, CHERRY, LEMON],
  ]))
  const lambda = lines.find((l) => l.lineIndex === 4)
  assert.ok(lambda, 'Λ diagonal should win')
  assert.equal(lambda.symbol, SEVEN)
  assert.equal(lambda.runLength, 3)
})

test('winnings stack across multiple lines', () => {
  // top: 3 stars (5x) + middle: 3 sevens (3x) = 8x
  const { totalReturn, lines } = evaluateGrid(gridOf([
    [STAR, STAR, STAR, LEMON, CHERRY],
    [SEVEN, SEVEN, SEVEN, CHERRY, LEMON],
    [CHERRY, LEMON, CHERRY, LEMON, CHERRY],
  ]))
  assert.equal(lines.length, 2)
  assert.equal(totalReturn, 8)
})

test('the V diagonal line is evaluated', () => {
  // V path (0,0)(1,1)(2,2)(1,3)(0,4): 3 sevens on the first three cells
  const { lines } = evaluateGrid(gridOf([
    [SEVEN, CHERRY, LEMON, STAR, DIAMOND],
    [LEMON, SEVEN, CHERRY, LEMON, STAR],
    [CHERRY, LEMON, SEVEN, CHERRY, LEMON],
  ]))
  const v = lines.find((l) => l.lineIndex === 3)
  assert.ok(v, 'V diagonal should win')
  assert.equal(v.symbol, SEVEN)
  assert.equal(v.runLength, 3)
})

test('netForBet maps totalReturn to loss / push / win', () => {
  assert.equal(netForBet(0, 100), -100) // loss
  assert.equal(netForBet(1, 100), 0)    // push
  assert.equal(netForBet(3, 100), 200)  // 3x return -> +2x net
})

test('theoreticalRTP is house-positive and in the 92-94% band', () => {
  const rtp = theoreticalRTP()
  assert.ok(rtp > 0.92 && rtp < 0.94, `RTP ${rtp} out of band`)
})
