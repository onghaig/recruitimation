import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  ACCEPTED_TYPES,
  extractPerFile,
  combineExtracts,
  type FileExtract,
} from '../utils/extractText'

interface Props {
  /**
   * 'combine' merges all files into one candidate (calls onCombined with the
   * merged text). 'batch' keeps files separate (calls onBatch with per-file
   * extracts). Defaults to combine.
   */
  mode?: 'combine' | 'batch'
  onCombined?: (text: string) => void
  onBatch?: (results: FileExtract[]) => void
}

/**
 * Drag-and-drop / click-to-browse area that extracts text from PDF, TXT, and
 * HTML files in the browser and hands the result back to the parent.
 */
export default function DocumentDropzone({ mode = 'combine', onCombined, onBatch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function handleFiles(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : []
    if (files.length === 0) return

    setBusy(true)
    try {
      const results = await extractPerFile(files)
      const ok = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)

      if (mode === 'batch') {
        onBatch?.(results)
      } else if (ok.length > 0) {
        onCombined?.(combineExtracts(results))
      }

      if (ok.length > 0) {
        toast.success(`Extracted ${ok.length} file${ok.length > 1 ? 's' : ''}`)
      }
      if (failed.length > 0) {
        toast.error(`Could not read: ${failed.map((r) => r.name).join(', ')}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const hint =
    mode === 'batch'
      ? 'Each file becomes its own candidate'
      : 'Multiple files are combined into one candidate'

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-brand-400 bg-brand-50'
            : 'border-slate-300 hover:border-slate-400 bg-slate-50'
        }`}
      >
        {busy ? (
          <Loader2 size={20} className="animate-spin text-brand-500" />
        ) : (
          <Upload size={20} className="text-slate-400" />
        )}
        <p className="text-sm text-slate-600">
          {busy ? 'Extracting…' : 'Drop PDF, TXT, or HTML files here, or click to browse'}
        </p>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = '' // allow re-selecting the same file
        }}
      />
    </div>
  )
}
