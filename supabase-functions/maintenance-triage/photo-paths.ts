// Which storage paths maintenance-triage may sign for a job's photos.
//
// maintenance_jobs.photos is a JSON column the reporter writes from the
// client, so a path in it is untrusted: without this check a user with write
// access to ONE job could list another landlord's document path there and
// have the service-role client sign + read it into a Claude prompt (and its
// description back into ai_triage).
//
// Upload conventions in the private `property-documents` bucket:
//   * tenant repair photos (src/components/TenantPortal.jsx):
//       <reporter uid>/tenant-uploads/<ts>.<ext>   — reporter = job.user_id
//   * property documents (src/lib/api/_monolith.js):
//       <owner uid>/<property id>/<ts>_<name>      — owner = properties.user_id
// Anything else is skipped.

export function isAllowedJobPhotoPath(
  path: unknown,
  job: { user_id?: string | null; property_id: string },
  propertyOwnerId?: string | null,
): boolean {
  if (typeof path !== 'string' || !path || path.length > 512) return false
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('//')) return false
  const prefixes: string[] = []
  if (job.user_id) prefixes.push(`${job.user_id}/tenant-uploads/`)
  if (propertyOwnerId && job.property_id) prefixes.push(`${propertyOwnerId}/${job.property_id}/`)
  return prefixes.some((p) => path.startsWith(p) && path.length > p.length)
}

// Image types the Claude API accepts as image blocks. Anything else (HEIC,
// TIFF, …) would fail the whole request, so it is skipped.
export const CLAUDE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
