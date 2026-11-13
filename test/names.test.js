import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  familyThenInitials,
  initials,
  initialsBeforeFamily,
  parseName,
  parseNameList,
  splitNames,
} from '../lib/names.js'

test('splits a name list on top-level "and"', () => {
  assert.deepEqual(splitNames('Vaswani, Ashish and Shazeer, Noam and others'), [
    'Vaswani, Ashish',
    'Shazeer, Noam',
    'others',
  ])
})

test('does not split inside braces', () => {
  assert.deepEqual(splitNames('{Barnes and Noble}'), ['{Barnes and Noble}'])
})

test('parses the comma forms', () => {
  assert.deepEqual(parseName('Doe, Jane'), { family: 'Doe', given: 'Jane', suffix: '' })
  assert.deepEqual(parseName('Doe, Jr, John'), { family: 'Doe', suffix: 'Jr', given: 'John' })
  assert.deepEqual(parseName('van der Berg, Jan'), { family: 'van der Berg', given: 'Jan', suffix: '' })
})

test('parses the "First von Last" form', () => {
  assert.deepEqual(parseName('Jane Doe'), { family: 'Doe', given: 'Jane', suffix: '' })
  assert.deepEqual(parseName('Jean-Luc Picard'), { family: 'Picard', given: 'Jean-Luc', suffix: '' })
  assert.deepEqual(parseName('Jan van der Berg'), { family: 'van der Berg', given: 'Jan', suffix: '' })
})

test('treats a single token as a family name', () => {
  assert.deepEqual(parseName('Aristotle'), { family: 'Aristotle', given: '', suffix: '' })
})

test('renders initials and the two name orders', () => {
  assert.equal(initials('Jane Ann'), 'J. A.')
  assert.equal(initials(''), '')
  assert.equal(initialsBeforeFamily({ family: 'Doe', given: 'Jane Ann' }), 'J. A. Doe')
  assert.equal(familyThenInitials({ family: 'Doe', given: 'Jane Ann' }), 'Doe, J. A.')
  assert.equal(initialsBeforeFamily({ family: 'Doe', given: '' }), 'Doe')
})

test('parses a whole field', () => {
  const people = parseNameList('Einstein, Albert and Bohr, Niels')
  assert.equal(people.length, 2)
  assert.deepEqual(
    people.map((person) => person.family),
    ['Einstein', 'Bohr'],
  )
})
