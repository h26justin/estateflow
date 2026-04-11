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
  const lines = text.split('\n').map(function(l) { return l.trim() }).filter(Boolean)
  var result = {
    format: 'PNE', statementNo: '', date: '', company: '',
    totalIncome: 0, totalFees: 0, paymentAmount: 0, items: []
  }

  var stmtRe    = new RegExp('Statement No\\s*[:.\\s]?\\s*(\\d+)', 'i')
  var dateRe    = new RegExp('(\\d+(?:st|nd|rd|th)?\\s+\\w+\\s+\\d{4})', 'i')
  var payRe     = new RegExp('PAYMENT AMOUNT\\s*[\\u00A3]?([\\d,]+\\.?\\d*)', 'i')
  var rentRe    = new RegExp('Rent for the month\\s+(\\d{2}\\/\\d{2}\\/\\d{4})\\s+to\\s+(\\d{2}\\/\\d{2}\\/\\d{4})', 'i')
  var amtRe     = new RegExp('[\\u00A3]([\\d,]+\\.?\\d*)')
  var tenantRe  = new RegExp('- (.+?)(?:\\s+[\\u00A3]|$)')
  var commRe    = new RegExp('Management Commission\\s+([\\d.]+)%\\s+of\\s+[\\u00A3]([\\d,]+\\.?\\d*)', 'i')
  var commAmt   = new RegExp('[\\u00A3]([\\d,]+\\.?\\d*)\\s*[\\u00A3]0')
  var expRe     = new RegExp('^Expenditure\\s*$', 'i')
  var expAmt    = new RegExp('^Expenditure\\s+Amount', 'i')
  var incRe     = new RegExp('^Income\\s*$', 'i')
  var summRe    = new RegExp('^(Summary|Our Invoice)$', 'i')
  var propRe    = new RegExp('Flat\\s+\\d+|Room\\s+\\d+|House|Avenue|Street|Road|Place|Close|Drive|Way|Court', 'i')
  var numStartRe = new RegExp('^\\d+\\s+\\w')
  var wsRe      = new RegExp('\\s+', 'g')

  for (var x = 0; x < lines.length; x++) {
    var line = lines[x]
    var sm = line.match(stmtRe)
    if (sm) result.statementNo = sm[1]
    var dm = line.match(dateRe)
    if (dm && !result.date) result.date = dm[1]
    if (!result.company && (line.includes('Property Group') || line.includes('EXH') || line.includes('Vale') || line.includes('Nouchette') || line.includes('AliCat') || line.includes('WxH'))) {
      result.company = line
    }
    var pm = line.match(payRe)
    if (pm) result.paymentAmount = parseCurrency(pm[1])
  }

  var currentProperty = null
  var inExpenditure = false

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (expRe.test(line) || expAmt.test(line)) { inExpenditure = true; continue }
    if (incRe.test(line)) { inExpenditure = false; continue }
    if (summRe.test(line)) break

    var isPropertyLine = !line.includes('\u00A3') &&
      !line.match(new RegExp('^\\d')) &&
      !line.match(new RegExp('^(Rent for|Management|VAT|Gross|Amount|Income|Expenditure|Statement|Balance|Payment|Total)', 'i')) &&
      line.length > 5 && line.length < 80 &&
      (propRe.test(line) || numStartRe.test(line))

    if (isPropertyLine && !inExpenditure) {
      currentProperty = line.replace(wsRe, ' ').trim()
      continue
    }

    var rentM = line.match(rentRe)
    if (rentM && currentProperty) {
      var am = line.match(amtRe)
      if (am) {
        var amount = parseCurrency(am[1])
        var tm = line.match(tenantRe)
        var tenant = tm ? tm[1].trim() : ''
        var period = rentM[1] + ' to ' + rentM[2]
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

    if (inExpenditure && isPropertyLine) {
      currentProperty = line.replace(wsRe, ' ').trim()
    }
  }

  return result
}

export function parseRMS(text) {
  var lines = text.split('\n').map(function(l) { return l.trim() }).filter(Boolean)
  var result = {
    format: 'RMS', statementNo: '', date: '', company: '',
    totalIncome: 0, totalFees: 0, paymentAmount: 0, items: []
  }

  var refRe     = new RegExp('Reference:\\s*(\\S+)', 'i')
  var dateRe    = new RegExp('Date:\\s*(\\d{2}\\/\\d{2}\\/\\d{4})', 'i')
  var rentRe    = new RegExp('Rent Received From (.+?) - (\\d{2}\\/\\d{2}\\/\\d{4}) to (\\d{2}\\/\\d{2}\\/\\d{4})', 'i')
  var mgmtRe    = new RegExp('Management Fee @ ([\\d.]+)%\\s*-\\s*\\(([\\d.]+)%\\s+of\\s+[\\u00A3]([\\d,]+\\.?\\d*)\\)', 'i')
  var feeRe     = new RegExp('([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})')
  var maintRe   = new RegExp('\\(Inv:([^)]+)\\)\\s+(.+?)(?:\\s+([\\d,]+\\.\\d{2}))?$')
  var amtRe     = new RegExp('([\\d,]+\\.\\d{2})')
  var propRe    = new RegExp('Avenue|Street|Road|House|Place|Flat|Room', 'i')
  var payRe     = new RegExp('Payment made to Owner\\s+([\\d,]+\\.\\d{2})', 'i')

  for (var x = 0; x < lines.length; x++) {
    var line = lines[x]
    var rm = line.match(refRe); if (rm) result.statementNo = rm[1]
    var dm = line.match(dateRe); if (dm) result.date = dm[1]
    if (!result.company && (line.includes('Property Group') || line.includes('Vale') || line.includes('EXH'))) result.company = line
  }

  function findPropBefore(lines, idx) {
    for (var j = idx - 1; j >= Math.max(0, idx - 5); j--) {
      if (propRe.test(lines[j]) && !lines[j].match(new RegExp('Rent|Management|Fee', 'i'))) {
        return lines[j].replace(new RegExp('\\s+', 'g'), ' ').trim()
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
  var propRe     = new RegExp('(?:flat|room)\\s*(\\d+[ab]?)', 'i')
  var numRe      = new RegExp('^(\\d+)\\s')
  var wattsRe    = new RegExp('watts moses', 'i')
  var esplRe     = new RegExp('esplanade', 'i')
  var stGeoRe    = new RegExp('st\\.?\\s*georges?', 'i')
  var parkEastRe = new RegExp('park place east', 'i')
  var parkWestRe = new RegExp('park place west', 'i')
  var turnRe     = new RegExp('turnberry', 'i')

  return items.map(function(item) {
    if (!item.propertyName) return item
    var name = item.propertyName.toLowerCase()
    var bestMatch = null, bestScore = 0

    for (var k = 0; k < properties.length; k++) {
      var prop = properties[k]
      var propName = prop.name.toLowerCase()
      var propAddr = (prop.address || '').toLowerCase()
      var score = 0

      var fn1 = name.match(propRe), fn2 = propName.match(propRe)
      if (fn1 && fn2 && fn1[1] === fn2[1]) score += 10

      if (wattsRe.test(name) && wattsRe.test(propName)) score += 5
      if (esplRe.test(name) && esplRe.test(propName)) score += 5
      if (stGeoRe.test(name) && (stGeoRe.test(propName) || propName.includes('georges'))) score += 5
      if (parkEastRe.test(name) && parkEastRe.test(propName)) score += 5
      if (parkWestRe.test(name) && parkWestRe.test(propName)) score += 5
      if (turnRe.test(name) && (turnRe.test(propName) || turnRe.test(propAddr))) score += 5

      var n1 = name.match(numRe), n2 = propName.match(numRe) || propAddr.match(numRe)
      if (n1 && n2 && n1[1] === n2[1]) score += 8

      var nameWords = name.split(/\s+/).filter(function(w) { return w.length > 3 })
      var propWords = (propName + ' ' + propAddr).split(/\s+/)
      var overlap = nameWords.filter(function(w) {
        return propWords.some(function(pw) { return pw.includes(w) || w.includes(pw) })
      })
      score += overlap.length * 2

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
