// Statement parser - plain JS file (no JSX) so esbuild handles regex correctly

function parseCurrency(str) {
  if (!str) return 0
  return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0
}

export function detectFormat(text) {
  if (text.includes('PNE') || text.includes('Propertunity') || text.includes('Management Commission')) return 'PNE'
  if (text.includes('ROOK') || text.includes('rookmatthewssayer') || text.includes('Rook Matthews')) return 'RMS'
  return 'UNKNOWN'
}

export function parsePNE(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  var result = {
    format: 'PNE', statementNo: '', date: '', company: '',
    totalIncome: 0, totalFees: 0, paymentAmount: 0, items: []
  }

  var stmtRe   = /Statement No\s*[:.\\s]?\s*(\d+)/i
  var dateRe   = /(\d+(?:st|nd|rd|th)?\s+\w+\s+\d{4})/i
  var payRe    = /PAYMENT AMOUNT\s*[\u00A3]?([\d,]+\.?\d*)/i
  var rentRe   = /Rent for the month\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i
  var amtRe    = /[\u00A3]([\d,]+\.?\d*)/
  var commRe   = /Management Commission\s+([\d.]+)%\s+of\s+[\u00A3]([\d,]+\.?\d*)/i
  var commAmt  = /[\u00A3]([\d,]+\.?\d*)\s*[\u00A3]0/
  var expRe    = /^Expenditure\s*$/i
  var expAmt   = /^Expenditure\s+Amount/i
  var incRe    = /^Income\s*$/i
  var summRe   = /^(Summary|Our Invoice)$/i

  // A property line must contain a flat/unit/road reference AND not be an agent/header line
  // Key fix: allow lines starting with numbers (e.g. "16, Esplanade West Flat 2")
  var flatRe   = /(?:Flat|Room|Unit)\s*\d+/i
  var roadRe   = /(?:Avenue|Street|Road|Place|Close|Drive|Way|Court|Gardens|Crescent|Lane|Terrace)\b/i
  // Agent address keywords to EXCLUDE (so "Kent House Lane" etc don't get picked up)
  var agentRe  = /(?:Industrial Estate|Business|Innovation Centre|Sunderland|Beckenham|BR\d|SR\d)/i

  function isPropertyLine(line, inExp) {
    if (line.includes('\u00A3')) return false
    if (summRe.test(line)) return false
    if (/^(Rent for|Management|VAT|Gross|Amount|Income|Expenditure|Statement|Balance|Payment|Total|Date|Invoice|Fee|Commission)/i.test(line)) return false
    if (line.length < 5 || line.length > 100) return false
    if (agentRe.test(line)) return false  // exclude agent address lines
    // Must contain a flat reference OR a road type
    if (!flatRe.test(line) && !roadRe.test(line)) return false
    return true
  }

  // First pass: extract header fields
  for (var x = 0; x < lines.length; x++) {
    var l = lines[x]
    var sm = l.match(stmtRe); if (sm) result.statementNo = sm[1]
    var dm = l.match(dateRe); if (dm && !result.date) result.date = dm[1]
    var pm = l.match(payRe); if (pm) result.paymentAmount = parseCurrency(pm[1])
    if (!result.company && /(?:Property Group|EXH|Vale|Nouchette|AliCat|WxH)/i.test(l)) result.company = l
  }

  var currentProperty = null
  var inExpenditure = false

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]

    if (expRe.test(line) || expAmt.test(line)) { inExpenditure = true; continue }
    if (incRe.test(line)) { inExpenditure = false; continue }
    if (summRe.test(line)) break

    // Detect property name lines
    if (isPropertyLine(line, inExpenditure)) {
      currentProperty = line.replace(/\s+/g, ' ').trim()
      continue
    }

    // Rent line
    var rentM = line.match(rentRe)
    if (rentM) {
      var amount = 0
      var tenant = ''
      var period = rentM[1] + ' to ' + rentM[2]

      // Extract tenant from the SAME line (after the dates)
      var afterDates = line.substring(line.indexOf(rentM[2]) + rentM[2].length).trim()
      var tenantMatch = afterDates.match(/^[-\s]+(.+?)(?:\s+[\u00A3]|$)/)
      if (tenantMatch) tenant = tenantMatch[1].trim()

      // Look for amount on same line first
      var am = line.match(amtRe)
      if (am) {
        amount = parseCurrency(am[1])
      } else {
        // FIX: tenant name may have wrapped — check next 1-2 lines for the amount
        for (var j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
          var nextLine = lines[j]
          // If next line has an amount and doesn't look like a new property/keyword
          if (nextLine.includes('\u00A3') && !rentRe.test(nextLine) && !commRe.test(nextLine)) {
            var nam = nextLine.match(amtRe)
            if (nam) {
              amount = parseCurrency(nam[1])
              // The tenant name is on the next line before the £
              var beforeAmt = nextLine.split('\u00A3')[0].trim()
              if (beforeAmt && !tenant) tenant = beforeAmt
              else if (beforeAmt && tenant) tenant = (tenant + ' ' + beforeAmt).trim()
              i = j // skip the line we consumed
              break
            }
          }
        }
      }

      if (amount > 0 && currentProperty) {
        result.items.push({
          propertyName: currentProperty, type: 'rent',
          amount: amount, tenant: tenant, period: period,
          description: 'Rent ' + period + (tenant ? ' \u2014 ' + tenant : ''),
          include: true, matched: false, propertyId: null, editAmount: amount
        })
        result.totalIncome += amount
      }
      continue
    }

    // Management fee line
    var commM = line.match(commRe)
    if (commM && inExpenditure) {
      var ca = line.match(commAmt)
      if (ca) {
        var camount = parseCurrency(ca[1])
        result.items.push({
          propertyName: currentProperty || '', type: 'fee',
          amount: camount, tenant: '', period: result.date,
          description: 'Management fee ' + commM[1] + '%',
          include: true, matched: false, propertyId: null, editAmount: camount
        })
        result.totalFees += camount
      }
      continue
    }
  }

  return result
}

export function parseRMS(text) {
  var lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  var result = {
    format: 'RMS', statementNo: '', date: '', company: '',
    totalIncome: 0, totalFees: 0, paymentAmount: 0, items: []
  }

  var refRe   = /Reference:\s*(\S+)/i
  var dateRe  = /Date:\s*(\d{2}\/\d{2}\/\d{4})/i
  // RMS is inconsistent: some statements say "Rent Received From ...", others just
  // "Received from ...". Treat both the same. /i handles case variations.
  var rentRe  = /(?:Rent\s+)?Received\s+from\s+(.+?)\s+-\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i
  var mgmtRe  = /Management Fee @ ([\d.]+)%\s*-\s*\(([\d.]+)%\s+of\s+[\u00A3]([\d,]+\.?\d*)\)/i
  var feeRe   = /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/
  var maintRe = /\(Inv:([^)]+)\)\s+(.+?)(?:\s+([\d,]+\.\d{2}))?$/
  var amtRe   = /([\d,]+\.\d{2})/
  var payRe   = /Payment made to Owner\s+([\d,]+\.\d{2})/i

  // Expanded list of UK road/street/place suffixes — was previously only
  // Avenue|Street|Road|House|Place which missed Grove, Drive, Close, etc.
  var ROAD_SUFFIXES = 'Road|Street|Avenue|Lane|Drive|Way|Close|Crescent|Grove|' +
    'Place|Court|Gardens|Terrace|Square|Mews|Walk|Hill|Rise|Park|Row|View|' +
    'Heights|Vale|House|Villas|Green|Fields?|Cottages?|Buildings?|Yard|' +
    'Quay|Wharf|Parade|Boulevard'

  // Strip dates and £amounts, then look for "NUMBER WORDS SUFFIX" or "Flat N ..."
  function extractPropertyFromLine(line) {
    if (!line) return null
    // Skip full postal addresses (agent/company headers contain UK postcodes)
    if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/.test(line)) return null
    var cleaned = line
      .replace(/\d{2}[\/-]\d{2}[\/-]\d{4}/g, ' ')          // DD/MM/YYYY
      .replace(/[\u00A3]?[\d,]+\.\d{2}/g, ' ')             // £1,234.56
      .replace(/\s+/g, ' ').trim()
    // "12 Chester Grove", "24 Watts Moses House", etc.
    var numPattern = new RegExp(
      '\\b(\\d+[a-z]?,?\\s+' +
      '(?:[A-Z][a-zA-Z\'\\-]*(?:\\s+[A-Z][a-zA-Z\'\\-]*){0,4}?)\\s+' +
      '(?:' + ROAD_SUFFIXES + '))\\b',
      'i'
    )
    var m = cleaned.match(numPattern)
    if (m) return m[1].replace(/\s*,\s*$/, '').trim()
    // "Flat 2, 42 High Street" / "Room 3 Maple House"
    var flatPattern = /\b((?:Flat|Room|Unit)\s+\d+[a-z]?,?(?:\s+\d+,?)?(?:\s+[A-Z][a-zA-Z'\-]*){1,5})\b/i
    var fm = cleaned.match(flatPattern)
    if (fm) return fm[1].trim()
    return null
  }

  for (var x = 0; x < lines.length; x++) {
    var l = lines[x]
    var rm = l.match(refRe); if (rm) result.statementNo = rm[1]
    var dm = l.match(dateRe); if (dm) result.date = dm[1]
    if (!result.company && /(?:Property Group|Vale|EXH)/i.test(l)) result.company = l
  }

  // Find property name for the item at line `idx`.
  // Check the current line first (RMS puts property in the same row as the item),
  // then fall back to scanning up to 5 lines back for wrapped rows.
  function findPropForLine(lines, idx) {
    var here = extractPropertyFromLine(lines[idx])
    if (here) return here
    for (var j = idx - 1; j >= Math.max(0, idx - 5); j--) {
      var candidate = extractPropertyFromLine(lines[j])
      if (candidate) return candidate
    }
    return ''
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]

    var rentM = line.match(rentRe)
    if (rentM) {
      var propName = findPropForLine(lines, i)
      var am = line.match(amtRe)
      if (am) {
        var amount = parseCurrency(am[1])
        if (amount > 0 && amount < 50000) {
          var period = rentM[2] + ' to ' + rentM[3]
          result.items.push({
            propertyName: propName, type: 'rent',
            amount: amount, tenant: rentM[1].trim(), period: period,
            description: 'Rent ' + period + ' \u2014 ' + rentM[1].trim(),
            include: true, matched: false, propertyId: null, editAmount: amount
          })
          result.totalIncome += amount
        }
      }
      continue
    }

    var mgmtM = line.match(mgmtRe)
    if (mgmtM) {
      var propName2 = findPropForLine(lines, i)
      var fm2 = line.match(feeRe)
      if (fm2) {
        var total = parseCurrency(fm2[3])
        result.items.push({
          propertyName: propName2, type: 'fee',
          amount: total, tenant: '', period: result.date,
          description: 'Management fee ' + mgmtM[1] + '% (inc VAT)',
          include: true, matched: false, propertyId: null, editAmount: total
        })
        result.totalFees += total
      }
      continue
    }

    var maintM = line.match(maintRe)
    if (maintM && !line.includes('Balance') && !line.includes('Fee')) {
      var propName3 = findPropForLine(lines, i)
      var ma = line.match(amtRe)
      if (ma) {
        var mamount = parseCurrency(ma[1])
        if (mamount > 0 && mamount < 50000) {
          result.items.push({
            propertyName: propName3, type: 'maintenance',
            amount: mamount, tenant: '', period: result.date,
            description: maintM[2].trim(),
            include: true, matched: false, propertyId: null, editAmount: mamount
          })
        }
      }
    }

    var payM = line.match(payRe)
    if (payM) result.paymentAmount = parseCurrency(payM[1])
  }

  return result
}

// Street-type abbreviations that are safe to fold, so "35 Henley Rd" and
// "35 Henley Road" normalise identically. Deliberately excludes ambiguous
// two-letter forms — "st" is Saint as often as Street round here ("St Georges
// House"), and "dr" is Doctor.
var STREET_ABBR = {
  rd:'road', ave:'avenue', cres:'crescent', gdns:'gardens',
  ter:'terrace', sq:'square', gr:'grove', pde:'parade',
}

// Canonical form of a property label, used for exact alias lookup: lowercase,
// punctuation stripped, whitespace collapsed, street types folded.
export function normaliseStatementName(str) {
  return String(str || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(function (w) { return STREET_ABBR[w] || w })
    .join(' ')
}

// Levenshtein distance, abandoned as soon as it provably exceeds `max`. We
// only ever ask "within N edits?", so there's no point completing the matrix.
function editDistance(a, b, max) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  var prev = []
  for (var j = 0; j <= b.length; j++) prev[j] = j
  for (var i = 1; i <= a.length; i++) {
    var cur = [i]
    var rowMin = i
    for (var k = 1; k <= b.length; k++) {
      cur[k] = Math.min(
        prev[k] + 1,            // deletion
        cur[k - 1] + 1,         // insertion
        prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)  // substitution
      )
      if (cur[k] < rowMin) rowMin = cur[k]
    }
    if (rowMin > max) return max + 1   // every path from here is already too far
    prev = cur
  }
  return prev[b.length]
}

// Are two words the same word, allowing for a typo? Agents hand-key property
// labels, so "Henly" for "Henley" (one dropped letter) is routine. Tolerance
// scales with length: short words must be exact, because at 4 characters one
// edit is the difference between genuinely different units.
function sameWord(a, b) {
  if (a === b) return true
  var tol = a.length <= 4 || b.length <= 4 ? 0 : (a.length <= 7 ? 1 : 2)
  if (tol === 0) return false
  return editDistance(a, b, tol) <= tol
}

// `aliases` is an optional list of learned/seeded label → property mappings,
// shaped `{ property_id, alias }`. An alias is an exact, deterministic match:
// it exists precisely because fuzzy scoring got this label wrong before, so it
// must win outright rather than compete on score.
export function matchProperties(items, properties, aliases) {
  // alias_norm → property id. Built from explicit aliases first, then each
  // property's own name as an implicit alias — but only where the normalised
  // name is unambiguous, so two properties sharing a name never silently
  // resolve to whichever came last.
  var aliasMap = {}
  var nameCounts = {}
  for (var a = 0; a < properties.length; a++) {
    var nn = normaliseStatementName(properties[a].name)
    if (nn) nameCounts[nn] = (nameCounts[nn] || 0) + 1
  }
  for (var b = 0; b < properties.length; b++) {
    var nb = normaliseStatementName(properties[b].name)
    if (nb && nameCounts[nb] === 1) aliasMap[nb] = properties[b].id
  }
  // Explicit aliases are applied last so they can override an implicit name
  // match, and are ignored when they point at a property that no longer exists
  // (deleted duplicates leave their aliases behind).
  var known = {}
  properties.forEach(function (p) { known[p.id] = p })
  ;(aliases || []).forEach(function (al) {
    var norm = normaliseStatementName(al.alias_norm || al.alias)
    if (norm && known[al.property_id]) aliasMap[norm] = al.property_id
  })

  var flatRe = /(?:flat|room|unit)\s*(\d+[ab]?)/i
  var numRe  = /^(\d+)\s/
  // Extract all plausible unit/flat numbers from a string
  function extractNumbers(str) {
    var nums = new Set()
    // "Flat 5", "Room 3", "Unit 12"
    var fm = str.match(/(?:flat|room|unit)\s*(\d+[ab]?)/gi)
    if (fm) fm.forEach(function(m) { var n = m.match(/(\d+[ab]?)/i); if (n) nums.add(n[1].toLowerCase()) })
    // Leading number: "5 Watts Moses House" or "24 Watts Moses House"
    var lm = str.match(/^(\d+)\s/)
    if (lm) nums.add(lm[1])
    // "No. 5" or "No 5"
    var nm = str.match(/No\.?\s*(\d+)/gi)
    if (nm) nm.forEach(function(m) { var n = m.match(/(\d+)/); if (n) nums.add(n[1]) })
    return nums
  }

  // Extract the building/street name without numbers for comparison
  function buildingName(str) {
    return str.toLowerCase()
      .replace(/^\d+\s*,?\s*/, '')           // strip leading number
      .replace(/flat\s*\d+[ab]?\s*,?\s*/gi, '')  // strip "Flat X"
      .replace(/room\s*\d+[ab]?\s*,?\s*/gi, '')
      .replace(/unit\s*\d+[ab]?\s*,?\s*/gi, '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return items.map(function(item) {
    if (!item.propertyName) return item

    // Alias / exact-name hit short-circuits the scoring entirely.
    var aliasHit = aliasMap[normaliseStatementName(item.propertyName)]
    if (aliasHit) {
      return Object.assign({}, item, {
        matched: true,
        propertyId: aliasHit,
        matchedName: known[aliasHit].name,
        matchedVia: 'alias',
        matchScore: 100,
      })
    }

    var name = item.propertyName.toLowerCase()
    var stmtNums = extractNumbers(item.propertyName)
    var stmtBuilding = buildingName(item.propertyName)
    var bestMatch = null, bestScore = 0

    for (var k = 0; k < properties.length; k++) {
      var prop = properties[k]
      var propName = prop.name.toLowerCase()
      var propAddr = (prop.address || '').toLowerCase()
      var combined = propName + ' ' + propAddr
      var propNums = extractNumbers(prop.name + ' ' + (prop.address || ''))
      var propBuilding = buildingName(prop.name + ' ' + (prop.address || ''))
      var score = 0

      // Named building / road keyword bonuses
      var namedPatterns = [
        /esplanade/i, /st\.?\s*george/i, /park\s+place\s*(?:east|west)?/i,
        /turnberry/i, /watts\s*moses/i, /maple/i, /oak/i, /riverside/i, /crown/i
      ]
      var buildingMatch = false
      namedPatterns.forEach(function(re) {
        if (re.test(name) && re.test(combined)) { score += 6; buildingMatch = true }
      })

      // Street/road name word overlap. Compared against punctuation-free,
      // abbreviation-folded tokens and with a one-typo allowance, so a
      // hand-keyed "Henly Road" still finds "35 Henley Road".
      var nameWords = name.split(/\s+/).filter(function(w) { return w.length > 3 && !/^(flat|room|unit|the|and|for|from|rent|house)$/i.test(w) })
      var propWords = normaliseStatementName(combined).split(' ')
      var overlap = nameWords.filter(function(w) {
        var nw = normaliseStatementName(w)
        return propWords.some(function(pw) { return pw.includes(nw) || nw.includes(pw) || sameWord(nw, pw) })
      })
      score += overlap.length * 2

      // Building name similarity (fuzzy) — the general case behind the
      // hard-coded namedPatterns above. Two or more matching building words is
      // as good a signal as a named-building hit, and earns the same bonus:
      // without it a whole-house property with no unit number in the label
      // ("Henley Road") could only ever reach 4 points and never met the
      // threshold. Skipped when namedPatterns already fired, so a building
      // never gets paid twice for the same evidence.
      if (!buildingMatch && stmtBuilding && propBuilding) {
        var bWords = normaliseStatementName(stmtBuilding).split(' ').filter(function(w) { return w.length > 2 })
        var pWords = normaliseStatementName(propBuilding).split(' ')
        var bOverlap = bWords.filter(function(w) { return pWords.some(function(pw) { return sameWord(pw, w) }) })
        if (bOverlap.length >= 2) { score += 6; buildingMatch = true }
      }

      // Unit/flat number matching — the critical part
      if (stmtNums.size > 0 && propNums.size > 0) {
        var numberMatch = false
        stmtNums.forEach(function(n) {
          if (propNums.has(n)) numberMatch = true
        })
        if (numberMatch && buildingMatch) {
          score += 20  // strong: same building AND same unit number
        } else if (numberMatch) {
          score += 8   // number matches but building unclear
        } else if (buildingMatch) {
          // Right building, wrong unit — that is a positive identification of
          // a DIFFERENT property, not a weak match, so rule it out entirely.
          // A small penalty used to leave enough building/word score behind
          // that Flat 99's rent could land on Flat 18. Better to leave it
          // unmatched and make the user pick.
          score = 0
        }
      }

      if (score > bestScore) { bestScore = score; bestMatch = prop }
    }

    return Object.assign({}, item, {
      matched: bestScore >= 5,
      propertyId: bestScore >= 5 ? bestMatch.id : null,
      matchedName: bestScore >= 5 ? bestMatch.name : null,
      matchedVia: bestScore >= 5 ? 'score' : null,
      matchScore: bestScore
    })
  })
}
