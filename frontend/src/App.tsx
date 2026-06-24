import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { Briefcase, LayoutGrid, Zap, Send, Database } from 'lucide-react'
import JobManager from './views/JobManager'
import SwipeDeck from './views/SwipeDeck'
import ResultsGrid from './views/ResultsGrid'
import OutreachFlow from './views/OutreachFlow'
import PasteAndParse from './views/PasteAndParse'

const nav = [
  { to: '/jobs', label: 'Jobs', Icon: Briefcase },
  { to: '/swipe', label: 'Review', Icon: Zap },
  { to: '/results', label: 'Results', Icon: LayoutGrid },
  { to: '/outreach', label: 'Outreach', Icon: Send },
  { to: '/parse', label: 'Parse', Icon: Database },
]

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-bold text-brand-600 text-lg tracking-tight">Recruitimation</span>
          <nav className="flex gap-1">
            {nav.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/jobs" replace />} />
          <Route path="/jobs" element={<JobManager />} />
          <Route path="/swipe" element={<SwipeDeck />} />
          <Route path="/swipe/:jobId" element={<SwipeDeck />} />
          <Route path="/results" element={<ResultsGrid />} />
          <Route path="/results/:jobId" element={<ResultsGrid />} />
          <Route path="/outreach" element={<OutreachFlow />} />
          <Route path="/parse" element={<PasteAndParse />} />
        </Routes>
      </main>
    </div>
  )
}
