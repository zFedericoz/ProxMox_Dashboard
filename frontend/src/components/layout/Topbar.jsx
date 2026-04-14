import { useState, useEffect } from 'react'
import { RefreshCw, Wifi, WifiOff, User, LogOut, Search } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useWebSocket } from '../../hooks/useWebSocket'

export function Topbar({ title, onRefresh }) {
  const { user, logout } = useAuth()
  const { connected } = useWebSocket()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formattedDate = currentTime.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
  const formattedTime = currentTime.toLocaleTimeString('it-IT')

  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Cerca VM, Container..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-4 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500 w-64"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
            /
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {connected ? (
            <Wifi size={16} className="text-green-400" />
          ) : (
            <WifiOff size={16} className="text-red-400" />
          )}
          <span className="text-xs text-gray-400">
            {connected ? 'Live' : 'Riconnessione...'}
          </span>
        </div>

        <button
          onClick={onRefresh}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          title="Aggiorna (R)"
        >
          <RefreshCw size={18} />
        </button>

        <div className="h-6 w-px bg-gray-700" />

        <div className="text-right">
          <p className="text-xs text-gray-400">{formattedDate}</p>
          <p className="text-sm font-mono text-white">{formattedTime}</p>
        </div>

        <div className="h-6 w-px bg-gray-700" />

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-cyan-500/20 rounded-full flex items-center justify-center">
            <User size={16} className="text-cyan-400" />
          </div>
          <div className="text-sm">
            <p className="text-white font-medium">{user?.username || 'Admin'}</p>
            <p className="text-xs text-gray-500">{user?.role || 'admin'}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors ml-2"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  )
}
