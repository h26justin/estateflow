// Mapbox GL JS + its stylesheet, bundled from the exact-pinned npm package
// (3.6.0, the version previously loaded from api.mapbox.com without
// Subresource Integrity). Only ever imported dynamically from PropertyMap,
// so it is its own lazy chunk (JS + CSS) and never part of the entry bundle.
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

export default mapboxgl
