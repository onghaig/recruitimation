import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Send, Clock, CheckCircle } from 'lucide-react'

export default function OutreachFlow() {
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
  })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Outreach</h1>
      <p className="text-slate-500 mb-8">
        Select a candidate from the Results view to generate and manage outreach messages.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-lg"><Send size={18} className="text-blue-600" /></div>
            <h2 className="font-semibold">Draft</h2>
          </div>
          <p className="text-sm text-slate-500">
            Open a candidate card from the Results grid and click "Generate Outreach Draft" to have Claude write a personalised message.
          </p>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-yellow-100 rounded-lg"><Clock size={18} className="text-yellow-600" /></div>
            <h2 className="font-semibold">Review</h2>
          </div>
          <p className="text-sm text-slate-500">
            Edit the draft in the text area. When ready, click "Looks good, send" to log it — then paste manually into Indeed or LinkedIn.
          </p>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-100 rounded-lg"><CheckCircle size={18} className="text-emerald-600" /></div>
            <h2 className="font-semibold">Confirm</h2>
          </div>
          <p className="text-sm text-slate-500">
            Sent outreach is logged in the ATS automatically. No contact credits are spent without your explicit confirmation.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-4">Jump to a job's results</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {jobs.map((j) => (
            <Link
              key={j.id}
              to={`/results/${j.id}`}
              className="card p-4 hover:shadow-md transition-shadow"
            >
              <h3 className="font-medium">{j.title}</h3>
              <p className="text-sm text-slate-500">{[j.location, j.payRange].filter(Boolean).join(' · ')}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
