import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neutralGarrison } from './neutral.js'

test('neutralGarrison is deterministic and in range', () => {
  const a = neutralGarrison('USA-3514')
  const b = neutralGarrison('USA-3514')
  assert.deepEqual(a, b)
  assert.ok(a.soldier >= 50 && a.soldier <= 300)
  assert.equal(a.tank, 0)
})
