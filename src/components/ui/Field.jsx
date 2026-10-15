// <Field> — label + control + hint + error, with the accessibility wiring done
// for you. The control gets a generated id (unless it has one), and
// aria-invalid / aria-describedby pointing at the hint and error text.
//
//   <Field label="Monthly rent" hint="Before agent fees" error={errors.rent}>
//     <input value={rent} onChange={…} />
//   </Field>
//
//   // Render prop, when the control is wrapped or is a custom component:
//   <Field label="Postcode" error={err}>
//     {(a11y) => <PostcodeInput {...a11y} value={pc} />}
//   </Field>
//
// Props
//   label      node — rendered in a <label htmlFor>
//   hint       node — helper text under the control
//   error      node — error text; when truthy sets aria-invalid and role="alert"
//   required   bool — adds the required attribute + a visual marker
//   id         string — control id (default: generated with useId)
//   className / style — on the wrapper
//   children   a single element (cloned) or a function receiving
//              { id, 'aria-invalid', 'aria-describedby', required }
import { cloneElement, isValidElement, useId } from 'react'

export default function Field({ label, hint, error, required = false, id, className, style, children }) {
  const auto = useId()
  const childId = isValidElement(children) ? children.props.id : undefined
  const controlId = id || childId || `f${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined

  const existing = isValidElement(children) ? children.props['aria-describedby'] : undefined
  const describedBy = [existing, hintId, errorId].filter(Boolean).join(' ') || undefined
  const a11y = {
    id: controlId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    ...(required ? { required: true } : {}),
  }

  let control = null
  if (typeof children === 'function') control = children(a11y)
  else if (isValidElement(children)) control = cloneElement(children, a11y)
  else control = children

  return (
    <div className={['ui-field', error && 'has-error', className].filter(Boolean).join(' ')} style={style}>
      {label != null && (
        <label className="ui-field__label" htmlFor={controlId}>
          {label}{required && <span className="ui-field__req" aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      {hint && <div id={hintId} className="ui-field__hint">{hint}</div>}
      {error && <div id={errorId} className="ui-field__error" role="alert">{error}</div>}
    </div>
  )
}
