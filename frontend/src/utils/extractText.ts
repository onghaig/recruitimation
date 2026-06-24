/**
 * Client-side text extraction for the document ingestor.
 *
 * Supports PDF (via pdfjs-dist), HTML (strip to visible text), and plain text.
 * Everything runs in the browser so no new backend endpoint is needed — the
 * extracted text feeds the existing /api/parse flow.
 */
// Vite bundles the worker and gives us a URL string to point pdf.js at. This is
// just a URL (cheap); the heavy library code is loaded lazily below so it stays
// out of the initial bundle until a PDF is actually dropped.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export const ACCEPTED_TYPES = '.pdf,.txt,.html,.htm,application/pdf,text/plain,text/html'

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      return lib
    })
  }
  return pdfjsPromise
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function isHtml(file: File): boolean {
  return file.type === 'text/html' || /\.html?$/i.test(file.name)
}

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await loadPdfjs()
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(text)
  }
  await pdf.cleanup()
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}

function extractHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove())
  const text = doc.body?.textContent ?? doc.documentElement.textContent ?? ''
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** Extract plain text from a single supported file. Throws on unreadable input. */
export async function extractTextFromFile(file: File): Promise<string> {
  if (isPdf(file)) return extractPdf(file)
  if (isHtml(file)) return extractHtml(await file.text())
  // Treat everything else (.txt and unknown text/*) as plain text.
  return (await file.text()).trim()
}

export interface FileExtract {
  name: string
  text: string
  ok: boolean
}

/** Extract text from several files, keeping each file's result separate. */
export async function extractPerFile(files: File[]): Promise<FileExtract[]> {
  const out: FileExtract[] = []
  for (const file of files) {
    try {
      out.push({ name: file.name, text: await extractTextFromFile(file), ok: true })
    } catch {
      out.push({ name: file.name, text: '', ok: false })
    }
  }
  return out
}

/**
 * Merge per-file extracts into one candidate profile. Each chunk is prefixed
 * with a `----- <filename> -----` header so the model (and the recruiter) can
 * see where each section came from.
 */
export function combineExtracts(results: FileExtract[]): string {
  return results
    .filter((r) => r.ok)
    .map((r) => `----- ${r.name} -----\n${r.text}`)
    .join('\n\n')
    .trim()
}
