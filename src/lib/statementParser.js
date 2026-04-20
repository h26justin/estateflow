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
  var rentRe  = /Rent Received From (.+?) - (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})/i
  var mgmtRe  = /Management Fee @ ([\d.]+)%\s*-\s*\(([\d.]+)%\s+of\s+[\u00A3]([\d,]+\.?\d*)\)/i
  var feeRe   = /([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/
  var maintRe = /\(Inv:([^)]+)\)\s+(.+?)(?:\s+([\d,]+\.\d{2}))?$/
  var amtRe   = /([\d,]+\.\d{2})/
  var propRe  = /Avenue|Street|Road|House|Place|Flat|Room/i
  var payRe   = /Payment made to Owner\s+([\d,]+\.\d{2})/i

  for (var x = 0; x < lines.length; x++) {
    var l = lines[x]
    var rm = l.match(refRe); if (rm) result.statementNo = rm[1]
    var dm = l.match(dateRe); if (dm) result.date = dm[1]
    if (!result.company && /(?:Property Group|Vale|EXH)/i.test(l)) result.company = l
  }

  function findPropBefore(lines, idx) {
    for (var j = idx - 1; j >= Math.max(0, idx - 5); j--) {
      if (propRe.test(lines[j]) && !/Rent|Management|Fee/i.test(lines[j])) {
        return lines[j].replace(/\s+/g, ' ').trim()
      }
    }
    return ''
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]

    var rentM = line.match(rentRe)
    if (rentM) {
      var propName = findPropBefore(lines, i)
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
      var propName2 = findPropBefore(lines, i)
      var fm = line.match(feeRe)
      if (fm) {
        var total = parseCurrency(fm[3])
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
      var propName3 = findPropBefore(lines, i)
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

export function matchProperties(items, properties) {
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

      // Street/road name word overlap
      var nameWords = name.split(/\s+/).filter(function(w) { return w.length > 3 && !/^(flat|room|unit|the|and|for|from|rent|house)$/i.test(w) })
      var propWords = combined.split(/\s+/)
      var overlap = nameWords.filter(function(w) { return propWords.some(function(pw) { return pw.includes(w) || w.includes(pw) }) })
      score += overlap.length * 2

      // Building name similarity (fuzzy)
      if (stmtBuilding && propBuilding) {
        var bWords = stmtBuilding.split(/\s+/).filter(function(w) { return w.length > 2 })
        var pWords = propBuilding.split(/\s+/)
        var bOverlap = bWords.filter(function(w) { return pWords.some(function(pw) { return pw === w }) })
        if (bOverlap.length >= 2) buildingMatch = true
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
          score -= 3   // same building but WRONG number — penalise
        }
      }

      if (score > bestScore) { bestScore = score; bestMatch = prop }
    }

    return Object.assign({}, item, {
      matched: bestScore >= 5,
      propertyId: bestScore >= 5 ? bestMatch.id : null,
      matchedName: bestScore >= 5 ? bestMatch.name : null,
      matchScore: bestScore
    })
  })
}
