// Exhaustive paging for Supabase/PostgREST queries.
//
// PostgREST caps every request at a server-side default (1000 rows here) and
// says nothing when it truncates — you just get fewer rows than exist. That is
// the dangerous shape of failure: code that reads "what already exists" in order
// to decide what to write will quietly decide wrong. The historic-data importer
// hit exactly this, planning 322 updates as inserts because the rows they would
// have matched were past the cap.
//
// Kept free of any Supabase import so it can be unit tested directly.

export const PAGE_SIZE = 1000

// build() must return a fresh query builder each call — a PostgREST builder is
// single-use, so reusing one across pages fails or returns the first page again.
// The builder must impose a stable ORDER BY: without one Postgres may order
// pages differently and a row can be returned twice or skipped entirely.
export async function fetchAllPages(build, { pageSize = PAGE_SIZE, maxPages = 1000 } = {}) {
  const out = []
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    out.push(...batch)
    // A short page is the end of the data. An exactly-full page is ambiguous,
    // so go round again and let the following empty page stop us.
    if (batch.length < pageSize) return out
  }
  // Guard against an endless loop if a caller's builder ignores range().
  throw new Error(`fetchAllPages: exceeded ${maxPages} pages — is the query ordered and ranged?`)
}
