import { useRef, useEffect } from 'react'
import { parseMoney } from './format'

// ── MoneyInput ────────────────────────────────────────────────────────────
// A drop-in replacement for <input type="number"> that displays values with
// thousand separators while storing them as raw numbers.
//
// USAGE:
//   <MoneyInput value={form.purchase_price} onChange={v => set('purchase_price', v)} />
//
// PROPS:
//   value      — the current numeric value (number | null | undefined | '')
//   onChange   — called with a Number on edit. Empty input → null.
//   prefix     — e.g. '£' (rendered as a styled span before the input)
//   suffix     — e.g. '%' or '/mo'
//   allowDecimals — default true. Set false for whole-pound fields.
//   min, max   — optional clamping (validates on blur, not on every keystroke)
//   placeholder, disabled, style, className — pass-through
//   ...rest    — everything else passes to the underlying <input>
//
// IMPLEMENTATION NOTES:
// - Internal display is the formatted string (with commas).
// - On every change we strip commas, parse to Number, and call onChange(Number).
// - Cursor position is preserved across re-renders by counting "digits before
//   cursor" in the OLD value, then finding the same digit-count position in
//   the NEW formatted value. This avoids the classic "type 1234 → see 1,234
//   → cursor jumps to end" bug.
// - We allow trailing decimal chars (`5.` and `5.0`) to remain typed without
//   forcing a re-format mid-typing — re-format happens on blur.

export default function MoneyInput({
  value,
  onChange,
  prefix,
  suffix,
  allowDecimals = true,
  min,
  max,
  placeholder = '',
  disabled = false,
  style = {},
  className,
  inputRef: externalInputRef,
  ...rest
}) {
  // Local string state mirrors what's in the input. We don't put this in
  // useState because we want to fully control what the <input> shows on each
  // render and avoid the React-controlled-input flicker. Instead we manage
  // the cursor with a ref.
  const inputRef = useRef(null)
  // Caller might want their own ref too — wire it up
  useEffect(() => {
    if (typeof externalInputRef === 'function') externalInputRef(inputRef.current)
    else if (externalInputRef && 'current' in externalInputRef) externalInputRef.current = inputRef.current
  }, [externalInputRef])

  // Ref so the cursor restoration logic can access the previous formatted
  // string and where the cursor was, in order to compute where it should be
  // after the new formatted string is applied.
  const lastDisplayRef = useRef('')

  // Format a numeric value for display. Empty / null / undefined → empty
  // string (we don't show `0` for an empty field — that's annoying UX).
  function formatForDisplay(v) {
    if (v === '' || v == null || (typeof v === 'number' && isNaN(v))) return ''
    const n = typeof v === 'number' ? v : parseMoney(v)
    if (isNaN(n)) return ''
    // Preserve in-progress decimal entry: if v is a string ending in '.'
    // or '.0', return as-typed (the user is mid-typing). The component
    // controls display purely via the value prop in normal use, but if the
    // caller passed a raw string we respect that.
    if (typeof v === 'string' && /\.$|\.\d*0$/.test(v.replace(/,/g, ''))) {
      return formatPartial(v)
    }
    // Whole-number display when no decimal or trailing zeros
    if (Number.isInteger(n)) {
      return new Intl.NumberFormat('en-GB').format(n)
    }
    // Decimal display: respect the precision the user typed up to 4 places
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(n)
  }

  // Format a string that's mid-edit (preserves trailing dot/zeros).
  // Splits at the decimal point, formats integer half, leaves decimal half.
  function formatPartial(str) {
    const cleaned = String(str).replace(/[£,\s]/g, '')
    const negative = cleaned.startsWith('-')
    const body = negative ? cleaned.slice(1) : cleaned
    const dotIdx = body.indexOf('.')
    if (dotIdx === -1) {
      const n = parseFloat(body)
      if (isNaN(n)) return ''
      return (negative ? '-' : '') + new Intl.NumberFormat('en-GB').format(n)
    }
    const intPart = body.slice(0, dotIdx)
    const decPart = body.slice(dotIdx) // includes the dot
    const intN = parseFloat(intPart || '0')
    const formatted = new Intl.NumberFormat('en-GB').format(intN)
    return (negative ? '-' : '') + formatted + decPart
  }

  // Compute the displayed string for the current value prop.
  // If we're in the middle of typing (the input is focused AND the parsed
  // value would round-trip to the same display), prefer the existing input
  // value to preserve in-progress decimal entry.
  const displayValue = (() => {
    const focused = inputRef.current && document.activeElement === inputRef.current
    if (focused && lastDisplayRef.current) {
      // Compare on numeric value: if the user-typed string parses to the same
      // number as the prop, keep their string (preserves "5." or "1,234.0").
      const typed = parseMoney(lastDisplayRef.current)
      const prop  = typeof value === 'number' ? value : parseMoney(value)
      if (!isNaN(typed) && !isNaN(prop) && typed === prop) {
        return lastDisplayRef.current
      }
    }
    return formatForDisplay(value)
  })()

  // Cursor restoration after re-render. We can't do this purely in render
  // (React owns the DOM), so use useEffect to set selectionStart/End back
  // to the right "digit-equivalent" position.
  // We don't always run this — only when the displayValue changed AS A
  // RESULT OF onChange (not from the parent setting a totally new value).
  // We track that via the ref and the imperative cursor we stash on input.
  const pendingCursorRef = useRef(null)
  useEffect(() => {
    if (pendingCursorRef.current != null && inputRef.current) {
      const pos = pendingCursorRef.current
      const len = inputRef.current.value.length
      const safe = Math.min(pos, len)
      try {
        inputRef.current.setSelectionRange(safe, safe)
      } catch(e) { /* some input types throw; safe to ignore */ }
      pendingCursorRef.current = null
    }
  }, [displayValue])

  // Convert a cursor position in the OLD formatted string to the equivalent
  // position in the NEW formatted string. We do this by counting how many
  // "digits or dots" appeared before the cursor, then finding that same
  // count of digits-or-dots in the new string and putting the cursor after.
  function mapCursor(oldStr, oldPos, newStr) {
    // Count chars-of-interest (digits, dots, minus) up to oldPos
    let count = 0
    for (let i = 0; i < oldPos; i++) {
      if (/[\d.\-]/.test(oldStr.charAt(i))) count++
    }
    // Walk newStr finding where to land after `count` chars-of-interest
    let seen = 0
    for (let i = 0; i < newStr.length; i++) {
      if (seen === count) return i
      if (/[\d.\-]/.test(newStr.charAt(i))) seen++
    }
    return newStr.length
  }

  function handleChange(e) {
    const oldDisplay = lastDisplayRef.current || ''
    const oldCursor = e.target.selectionStart ?? 0
    const typed = e.target.value

    // Reject characters we don't want. Allow digits, comma, dot (if decimals
    // allowed), minus only at start. Whitespace silently stripped.
    let cleaned = typed.replace(/\s/g, '')
    if (!allowDecimals) cleaned = cleaned.replace(/\./g, '')
    // Strip any second minus or non-leading minus
    cleaned = cleaned.replace(/(?!^)-/g, '')
    // Reject anything other than digits/comma/dot/minus
    if (/[^\d,.\-]/.test(cleaned)) {
      // Filter out invalid chars rather than rejecting the whole input
      cleaned = cleaned.replace(/[^\d,.\-]/g, '')
    }

    // Parse the numeric value
    const numeric = cleaned === '' || cleaned === '-' ? null : parseMoney(cleaned)
    const numericFinal = numeric == null || isNaN(numeric) ? null : numeric

    // Reformat for display
    const newDisplay = numericFinal == null
      ? cleaned // still allow user to see what they typed (e.g. "-")
      : formatPartial(cleaned)

    // Compute where cursor should land in newDisplay
    pendingCursorRef.current = mapCursor(typed, oldCursor, newDisplay)
    lastDisplayRef.current = newDisplay

    onChange(numericFinal)
  }

  function handleBlur(e) {
    // On blur, normalise the display to the canonical formatted form. Also
    // clamp to [min, max] if specified — but only on blur so we don't fight
    // the user mid-typing (they might be deleting a digit to retype).
    let v = typeof value === 'number' ? value : parseMoney(value)
    if (isNaN(v)) v = null
    if (v != null) {
      if (typeof min === 'number' && v < min) v = min
      if (typeof max === 'number' && v > max) v = max
    }
    if (v !== value) onChange(v)
    lastDisplayRef.current = formatForDisplay(v)
    if (rest.onBlur) rest.onBlur(e)
  }

  // Keep ref in sync after every render so next change can compute cursor
  useEffect(() => { lastDisplayRef.current = displayValue }, [displayValue])

  // If the caller doesn't want a prefix/suffix, just render the bare input
  if (!prefix && !suffix) {
    return (
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        style={style}
        className={className}
      />
    )
  }

  // With prefix/suffix, wrap in a flex container
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: style.width || '100%' }}>
      {prefix && (
        <span style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 12, color: '#888', pointerEvents: 'none', userSelect: 'none',
        }}>{prefix}</span>
      )}
      <input
        {...rest}
        ref={inputRef}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        value={displayValue}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          ...style,
          width: '100%',
          paddingLeft:  prefix ? (style.paddingLeft  || 26) : style.paddingLeft,
          paddingRight: suffix ? (style.paddingRight || 32) : style.paddingRight,
        }}
        className={className}
      />
      {suffix && (
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, color: '#888', pointerEvents: 'none', userSelect: 'none',
        }}>{suffix}</span>
      )}
    </div>
  )
}
