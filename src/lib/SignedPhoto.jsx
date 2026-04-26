// Renders an image stored in the private property-documents bucket by fetching
// a short-lived signed URL from its durable storage path. Falls back to a
// legacy `url` (older public URL) if no path is set, then to an error
// placeholder if neither resolves.
//
// Wraps in an anchor so click opens full-size in a new tab. Caller controls
// the visual style via the `style` prop.

import { useState, useEffect } from 'react'
import * as api from './api'

export function SignedPhoto({ path, url, alt = '', style, wrapAnchor = true }) {
  const [signedUrl, setSignedUrl] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    if (path) {
      api.getDocumentSignedUrl(path)
        .then(u => { if (!cancelled) setSignedUrl(u) })
        .catch(() => { if (!cancelled) setError(true) })
    }
    return () => { cancelled = true }
  }, [path])

  // Resolution priority: signed URL (preferred) → legacy public url → error placeholder
  const src = signedUrl || (path ? null : url)

  if (error || !src) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#222', color: '#888', fontSize: 10 }}>
        {error ? '✕' : '…'}
      </div>
    )
  }

  const img = <img src={src} alt={alt} style={style}/>
  if (!wrapAnchor) return img
  return (
    <a href={src} target="_blank" rel="noreferrer">{img}</a>
  )
}
