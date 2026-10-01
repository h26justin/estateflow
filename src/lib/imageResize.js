// Shrink a photo in the browser before it is uploaded: a phone photo is
// 3-8 MB and 4000+ px, the workspace never shows it wider than ~1600 px.
//
// Returns { file, width, height }. Anything the browser cannot decode
// (HEIC outside Safari, a corrupt file) or that is already small comes back
// unchanged, so a resize failure never blocks an upload.

export async function resizeImage(file, { maxDim = 2400, quality = 0.85, minBytes = 600 * 1024 } = {}) {
  if (!file || !String(file.type || '').startsWith('image/') || /gif|svg/.test(file.type)) return { file, width: null, height: null }
  let bitmap = null
  try {
    bitmap = typeof createImageBitmap === 'function'
      ? await createImageBitmap(file, { imageOrientation: 'from-image' })
      : await loadViaImg(file)
  } catch (_) {
    return { file, width: null, height: null }
  }
  const w0 = bitmap.width, h0 = bitmap.height
  const scale = Math.min(1, maxDim / Math.max(w0, h0))
  if (scale === 1 && file.size <= minBytes) {
    bitmap.close?.()
    return { file, width: w0, height: h0 }
  }
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); return { file, width: w0, height: h0 } }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob || blob.size >= file.size) return { file, width: w0, height: h0 }
  const name = String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
  return { file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() }), width: w, height: h }
}

function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = e => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

/**
 * Style for an <img> showing a cover photo with its saved crop, inside a
 * container with overflow hidden. crop = { x, y, zoom }: x / y are the focal
 * point in percent (0-100), zoom >= 1 scales up around that point.
 * object-fit: cover guarantees the frame is always filled, whatever its
 * shape, so one stored file serves the card, the hero and the list.
 */
export function coverImgStyle(crop) {
  const c = normaliseCrop(crop)
  return {
    width: '100%', height: '100%', display: 'block', objectFit: 'cover',
    objectPosition: `${c.x}% ${c.y}%`,
    transform: c.zoom === 1 ? undefined : `scale(${c.zoom})`,
    transformOrigin: `${c.x}% ${c.y}%`,
  }
}

export function normaliseCrop(crop) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  return {
    x: Math.max(0, Math.min(100, n(crop?.x, 50))),
    y: Math.max(0, Math.min(100, n(crop?.y, 50))),
    zoom: Math.max(1, Math.min(4, n(crop?.zoom, 1))),
  }
}
