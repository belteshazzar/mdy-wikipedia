/**
 * A Wikidata entity as a record.
 *
 * The claims are typed where an infobox is text — Babylon's inception is
 * `-1894-00-00T00:00:00Z` with `precision: 9`, against the infobox's
 * `c. 2200 BC` — which is the reason to want them. What makes them awkward is
 * that everything is an opaque id: `P31` is `Q133442`, and neither says
 * anything until both are looked up. `fetch.js` does that lookup; this turns
 * the result into `instance-of: city-state`.
 *
 * Two decisions worth naming.
 *
 * **External identifiers are left out unless asked for.** 66 of Babylon's 90
 * properties are `external-id` — GeoNames, Freebase, Quora, Giant Bomb, a dozen
 * library catalogues — 32 KB of cross-references that bury the two dozen claims
 * anybody came for. They are what you want when reconciling against another
 * database and not what you want when reading, so `identifiers` asks for them
 * and gets them under a key of their own. The datatype says which is which; no
 * list of properties has to be maintained.
 *
 * **A statement is written with the qualifiers that date it.** This is not a
 * refinement, it is the difference between a record and a wrong one: Babylon's
 * `country` is twelve statements, and flattened to twelve names it says Babylon
 * is in twelve countries and that the Parthian Empire is there twice. Each one
 * is qualified with the years it held — `Neo-Assyrian Empire, 911 BC to 626 BC`
 * — and with those it is three thousand years of who ruled Babylon. Only the
 * qualifiers that place a statement in time are kept, plus the one that says
 * how sure Wikidata is of it: `population: 150000` is `circa` and should not be
 * written as though it were counted.
 *
 * **Deprecated statements are dropped and preferred ones win.** Wikidata's rank
 * is how it records that a claim is superseded or disputed, and an importer
 * that ignores rank is an importer that quietly resurrects the wrong answer.
 */

// The qualifiers worth keeping, and what to call them. Ordered, because two can
// answer the same question — `start time` and `earliest date` are both a `from`
// — and the first one Wikidata offers is the more definite of the two.
const qualifiers = [
  ['from', ['P580', 'P1319']],
  ['to', ['P582', 'P1326']],
  ['when', ['P585']],
  // `sourcing circumstances`: `circa`, `presumably`, `near`. A number with this
  // on it is an estimate, and dropping it promotes a guess to a measurement.
  ['sourcing', ['P1480']]
]

const bce = (year) => Math.abs(year) + ' BC'
const ordinal = (value) => {
  const rest = value % 100
  const suffix =
    rest > 10 && rest < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'

  return value + suffix
}

/**
 * @param {object} entity
 *   The entity as `Special:EntityData` gives it.
 * @param {Record<string, string>} labels
 *   Labels for every property and item it names.
 * @param {{lang?: string, identifiers?: boolean}} [options]
 *   `identifiers` keeps the external-id properties, under a key of their own.
 * @returns {object}
 */
export function wikidataRecord(entity, labels, options = {}) {
  const lang = options.lang ?? 'en'
  /** @type {Record<string, unknown>} */
  const claims = {}
  /** @type {Record<string, unknown>} */
  const identifiers = {}

  for (const [property, statements] of Object.entries(entity.claims ?? {})) {
    const name = slug(labels[property] ?? property)
    const best = rank(statements)

    // Every statement deprecated is Wikidata saying the property has no
    // current answer — Q8409's IMDb id and its Great Russian Encyclopedia id
    // are each a single deprecated claim. Honouring rank means the property
    // says nothing, not that the retracted value comes back.
    if (!best.length) continue

    const isId = best[0].mainsnak?.datatype === 'external-id'

    if (isId && !options.identifiers) continue

    const values = even(
      best
        // An identifier is a string in another database's namespace and has
        // nothing to be qualified by, so only real claims are asked.
        .map((statement) =>
          isId ? render(statement.mainsnak, labels) : qualified(statement, labels)
        )
        .filter((value) => value !== undefined)
    )

    if (!values.length) continue

    const into = isId ? identifiers : claims
    const value = values.length === 1 ? values[0] : values

    // Two properties can slug to the same name — `P625` and a duplicate under
    // another label — and the first one written is the one Wikidata lists
    // first, which is the one it considers primary.
    if (into[name] === undefined) into[name] = value
  }

  /** @type {Record<string, unknown>} */
  const out = {id: entity.id}
  const label = entity.labels?.[lang]?.value ?? entity.labels?.en?.value
  const description =
    entity.descriptions?.[lang]?.value ?? entity.descriptions?.en?.value

  if (label) out.label = label
  if (description) out.description = description
  if (Object.keys(claims).length) out.claims = claims
  if (Object.keys(identifiers).length) out.identifiers = identifiers

  return out
}

/**
 * One shape for one property.
 *
 * Babylon was a `city-state` from 1894 BC to 1792 BC and is an `ancient city`
 * with no dates on it at all, so `instance-of` would come out as a list of a
 * record and two strings — and every reader of it would have to ask, of every
 * element, which of the two it had. Asking once per property is better, so if
 * any statement is dated they all say so.
 *
 * @param {Array<unknown>} values
 * @returns {Array<unknown>}
 */
function even(values) {
  const dated = values.some((value) => value !== null && typeof value === 'object' && 'value' in value)

  if (!dated) return values

  return values.map((value) =>
    value !== null && typeof value === 'object' && 'value' in value ? value : {value}
  )
}

/**
 * One statement: its value, and what places that value in time.
 *
 * A bare value when there is nothing to add, which is most of them — a record
 * where every scalar had become `{value: …}` would be a worse record for the
 * sake of the few that need it.
 *
 * @param {object} statement
 * @param {Record<string, string>} labels
 * @returns {unknown}
 */
function qualified(statement, labels) {
  const value = render(statement.mainsnak, labels)

  if (value === undefined) return

  /** @type {Record<string, unknown>} */
  const found = {}

  for (const [name, properties] of qualifiers) {
    for (const property of properties) {
      const snak = statement.qualifiers?.[property]?.[0]
      const rendered = snak ? render(snak, labels) : undefined

      if (rendered !== undefined) {
        found[name] = rendered
        break
      }
    }
  }

  return Object.keys(found).length ? {value, ...found} : value
}

/**
 * The statements that count.
 *
 * Deprecated ones are wrong on purpose — Wikidata keeps them to record that
 * somebody published them — and a preferred one is there to say "this, not the
 * others". Ignoring rank means writing down the superseded answer beside the
 * current one with nothing to tell them apart.
 *
 * @param {Array<object>} statements
 * @returns {Array<object>}
 */
function rank(statements) {
  const live = statements.filter((statement) => statement.rank !== 'deprecated')
  const preferred = live.filter((statement) => statement.rank === 'preferred')

  return preferred.length ? preferred : live
}

/**
 * One value, in the spelling its datatype deserves.
 *
 * @param {object} snak
 * @param {Record<string, string>} labels
 * @returns {unknown}
 */
function render(snak, labels) {
  // `novalue` and `somevalue` are Wikidata saying "there is none" and "there is
  // one and nobody knows it". Neither is a value to write down.
  if (snak?.snaktype !== 'value') return

  const {value} = snak.datavalue ?? {}

  switch (snak.datavalue?.type) {
    case 'wikibase-entityid':
      return labels[value.id] ?? value.id
    case 'time':
      return time(value)
    case 'globecoordinate':
      return {lat: value.latitude, lon: value.longitude}
    case 'quantity':
      return quantity(value, labels)
    case 'monolingualtext':
      return value.text
    case 'string':
      return snak.datatype === 'commonsMedia'
        ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' +
            encodeURIComponent(String(value).replaceAll(' ', '_'))
        : value
    default:
      return typeof value === 'string' ? value : undefined
  }
}

/**
 * A time, written to the precision Wikidata claims for it.
 *
 * The precision is the whole point. `-1894-00-00T00:00:00Z` is not the tenth of
 * never: it is the year 1894 BC, and the zeroes are Wikidata saying it does not
 * know the month. Writing it out as a date would invent two facts.
 *
 * @param {{time: string, precision: number}} value
 * @returns {string | undefined}
 */
function time(value) {
  const match = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(String(value.time ?? ''))

  if (!match) return

  const before = match[1] === '-'
  const year = Number(match[2])
  const [, , , month, day] = match

  if (!year) return

  if (value.precision >= 11) {
    return before
      ? bce(year) + ' (' + month + '-' + day + ')'
      : String(year).padStart(4, '0') + '-' + month + '-' + day
  }

  if (value.precision === 10) {
    return before ? bce(year) + ' (' + month + ')' : String(year).padStart(4, '0') + '-' + month
  }

  if (value.precision === 9) return before ? bce(year) : String(year)
  if (value.precision === 8) return (before ? bce(year) : year) + 's'
  if (value.precision === 7) {
    return ordinal(Math.ceil(year / 100)) + ' century' + (before ? ' BC' : '')
  }
  if (value.precision <= 6) {
    return ordinal(Math.ceil(year / 1000)) + ' millennium' + (before ? ' BC' : '')
  }
}

/**
 * @param {{amount: string, unit: string}} value
 * @param {Record<string, string>} labels
 * @returns {string}
 */
function quantity(value, labels) {
  const amount = String(value.amount ?? '').replace(/^\+/, '')
  const unit = String(value.unit ?? '')
  const name = unit.includes('/Q') ? labels[unit.slice(unit.lastIndexOf('/') + 1)] : undefined

  return name ? amount + ' ' + name : amount
}

/**
 * @param {string} value
 * @returns {string}
 */
function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}
