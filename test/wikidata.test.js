import assert from 'node:assert/strict'
import test from 'node:test'
import {wikidataRecord} from '../src/wikidata.js'
import {babylonEntity, babylonLabels} from './fixture.js'

const record = wikidataRecord(babylonEntity, babylonLabels)
const withIds = wikidataRecord(babylonEntity, babylonLabels, {identifiers: true})

test('the entity says what it is', () => {
  assert.equal(record.id, 'Q5684')
  assert.equal(record.label, 'Babylon')
  assert.match(record.description, /capital city of Babylonia/)
})

test('claims are readable, because both halves are looked up', () => {
  // `P31` → `Q133442` says nothing until both are resolved.
  assert.deepEqual(record.claims['instance-of'], [
    // A city-state only while it was one: Hammurabi's Babylon.
    {value: 'city-state', from: '1894 BC', to: '1792 BC'},
    {value: 'ancient city'},
    {value: 'archaeological site'}
  ])
  assert.equal(
    record.claims['located-in-the-administrative-territorial-entity'],
    'Babylon Governorate'
  )
})

test('external identifiers are left out unless they are asked for', () => {
  // 66 of Babylon's 90 properties are external ids — 32 KB of cross-references
  // to other databases, none of it about Babylon. The datatype says which is
  // which, so no list of properties has to be kept up to date.
  assert.equal(record.identifiers, undefined)
  assert.ok(Object.keys(record.claims).length < 30)

  for (const name of Object.keys(record.claims)) {
    assert.ok(!name.endsWith('-id'), name + ' looks like an identifier')
  }
})

test('and are kept apart from the claims when they are', () => {
  assert.equal(withIds.identifiers['geonames-id'], '98228')
  assert.equal(withIds.identifiers['freebase-id'], '/m/01cyh')
  assert.ok(Object.keys(withIds.identifiers).length > 50)
  assert.deepEqual(
    Object.keys(withIds.claims),
    Object.keys(record.claims),
    'asking for them changes nothing about the claims'
  )
})

test('a statement is written with the years it held for', () => {
  // Babylon's `country` is twelve statements. Flattened to twelve names it says
  // Babylon is in twelve countries and that the Parthian Empire is two of them;
  // with the qualifiers it is three thousand years of who ruled Babylon.
  const held = record.claims.country

  assert.equal(held.length, 12)
  assert.deepEqual(held[0], {value: 'Babylonia', from: '1880 BC', to: '911 BC'})
  assert.deepEqual(held[1], {
    value: 'Neo-Assyrian Empire',
    from: '911 BC',
    to: '626 BC'
  })

  // Twice, and they are different: Parthia held Babylon, lost it, took it back.
  const parthia = held.filter((one) => one.value === 'Parthian Empire')

  assert.equal(parthia.length, 2)
  assert.notDeepEqual(parthia[0], parthia[1])
})

test('a value nobody counted is not written as though it were', () => {
  // `sourcing circumstances: circa`. Dropping it promotes a guess to a
  // measurement.
  assert.deepEqual(record.claims.population, {value: '150000', sourcing: 'circa'})
})

test('a statement with nothing to date it stays the value it was', () => {
  // Most of them. A record where every scalar had become `{value: …}` would be
  // a worse record for the sake of the few that need it.
  assert.equal(record.claims['commons-category'], 'Babylon')
  assert.equal(record.claims.continent, 'Asia')
  assert.equal(record.claims['native-label'], 'Babili(m)')
})

test('a property is one shape or the other, never both', () => {
  // `instance-of` is three statements and only the first is dated. Left alone
  // it would be a list of a record and two strings, and every reader of it
  // would have to ask of every element which of the two it had.
  for (const value of Object.values(record.claims)) {
    const list = Array.isArray(value) ? value : [value]
    const records = list.filter(
      (one) => one !== null && typeof one === 'object' && 'value' in one
    )

    assert.ok(
      records.length === 0 || records.length === list.length,
      'a property should not mix dated statements with bare ones'
    )
  }
})

test('a deprecated statement is not the answer', () => {
  // Babylon's inception has two claims: a deprecated one to the year 1894 BC,
  // and a live one to the 3rd millennium BC. Ignoring rank writes down the
  // superseded answer with nothing to say it is superseded.
  // And `no later than` is Wikidata saying the date is a bound, not a year.
  assert.deepEqual(record.claims.inception, {
    value: '3rd millennium BC',
    sourcing: 'no later than'
  })
})

test('a time is written to the precision it claims', () => {
  const at = (time, precision) =>
    wikidataRecord(
      {
        id: 'Q1',
        claims: {
          P1: [
            {
              rank: 'normal',
              mainsnak: {
                snaktype: 'value',
                datatype: 'time',
                datavalue: {type: 'time', value: {time, precision}}
              }
            }
          ]
        }
      },
      {P1: 'when'}
    ).claims.when

  assert.equal(at('+1815-12-10T00:00:00Z', 11), '1815-12-10')
  assert.equal(at('+1815-12-00T00:00:00Z', 10), '1815-12')
  assert.equal(at('+1815-00-00T00:00:00Z', 9), '1815')
  assert.equal(at('+1810-00-00T00:00:00Z', 8), '1810s')
  assert.equal(at('+1815-00-00T00:00:00Z', 7), '19th century')
  // The zeroes are Wikidata saying it does not know the month, so writing this
  // out as a date would invent two facts.
  assert.equal(at('-1894-00-00T00:00:00Z', 9), '1894 BC')
  assert.equal(at('-2200-00-00T00:00:00Z', 6), '3rd millennium BC')
})

test('the other datatypes come out as themselves', () => {
  assert.deepEqual(record.claims['coordinate-location'][0], {
    lat: 32.5425,
    lon: 44.42111111111111
  })
  assert.match(record.claims.image, /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//)
  assert.equal(record.claims['commons-category'], 'Babylon')
})

test('a value nobody knows is not written down as one', () => {
  // `somevalue` is Wikidata saying there is one and nobody knows it.
  const record = wikidataRecord(
    {
      id: 'Q1',
      claims: {
        P1: [{rank: 'normal', mainsnak: {snaktype: 'somevalue', datatype: 'wikibase-item'}}]
      }
    },
    {P1: 'father'}
  )

  assert.equal(record.claims, undefined)
})

test('without labels it degrades to ids rather than to nothing', () => {
  const bare = wikidataRecord(babylonEntity, {})

  // The dates come through either way: a time is a time without a lookup.
  assert.deepEqual(bare.claims.p31, [
    {value: 'Q133442', from: '1894 BC', to: '1792 BC'},
    {value: 'Q15661340'},
    {value: 'Q839954'}
  ])
})

test('a label in any script keys as itself', () => {
  const record = wikidataRecord(
    {
      id: 'Q1',
      claims: {
        P1: [
          {
            rank: 'normal',
            mainsnak: {
              snaktype: 'value',
              datatype: 'external-id',
              datavalue: {type: 'string', value: 'babylone'}
            }
          }
        ]
      }
    },
    {P1: 'Encyclopædia Universalis ID'},
    {identifiers: true}
  )

  assert.equal(record.identifiers['encyclopædia-universalis-id'], 'babylone')
})

test('a property whose every statement is deprecated says nothing', () => {
  // Q8409 — Alexander the Great — carries an IMDb id and a Great Russian
  // Encyclopedia id that are each a single deprecated claim, so `rank` has
  // nothing to hand back. Reading a datatype off the first of none is how six
  // of forty-one ancient-history articles failed to import at all.
  const record = wikidataRecord(
    {
      id: 'Q8409',
      claims: {
        P345: [
          {
            rank: 'deprecated',
            mainsnak: {
              snaktype: 'value',
              datatype: 'external-id',
              datavalue: {type: 'string', value: 'nm0018002'}
            }
          }
        ],
        P31: [
          {
            rank: 'normal',
            mainsnak: {
              snaktype: 'value',
              datatype: 'wikibase-item',
              datavalue: {type: 'wikibase-entityid', value: {id: 'Q5'}}
            }
          }
        ]
      }
    },
    {P345: 'IMDb ID', P31: 'instance of', Q5: 'human'}
  )

  assert.equal(record.claims['imdb-id'], undefined)
  assert.equal(record.claims['instance-of'], 'human')
})
