import { useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { FileText, Search, Trash2, Download, Filter, X } from 'lucide-react'

export function Logs() {
  const { data: logsData, refetch } = useApi('/api/logs/realtime', { params: { limit: 200 }, refetchInterval: 10000 })
  
  const [search, setSearch] = useState('')
  const [filterNode, setFilterNode] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  
  const logs = logsData?.logs || []

  const allNodes = useMemo(() => {
    return Array.from(new Set(logs.map(log => log.node).filter(Boolean))).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    let result = [...logs]

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(log => {
        const msg = (log.msg || log.message || '').toLowerCase()
        const node = (log.node || '').toLowerCase()
        return msg.includes(s) || node.includes(s)
      })
    }

    if (filterNode) {
      result = result.filter(log => log.node === filterNode)
    }

    if (filterLevel) {
      result = result.filter(log => {
        const l = (log.level || log.pri || 'info' + '').toLowerCase()
        if (filterLevel === 'error') return l === 'err' || l === 'error' || l === 'crit'
        if (filterLevel === 'warning') return l === 'warn' || l === 'warning'
        return l === filterLevel
      })
    }

    return result
  }, [logs, search, filterNode, filterLevel])

  const getLevelColor = (level) => {
    const l = (level || 'info').toLowerCase()
    if (l === 'err' || l === 'error' || l === 'crit') return 'text-red-400'
    if (l === 'warn' || l === 'warning') return 'text-yellow-400'
    return 'text-cyan-400'
  }

  const getLevelBg = (level) => {
    const l = (level || 'info').toLowerCase()
    if (l === 'err' || l === 'error' || l === 'crit') return 'bg-red-900/30'
    if (l === 'warn' || l === 'warning') return 'bg-yellow-900/30'
    return ''
  }

  const clearFilters = () => {
    setSearch('')
    setFilterNode('')
    setFilterLevel('')
  }

  const hasActiveFilters = search || filterNode || filterLevel

  const exportLogs = () => {
    const content = filteredLogs.map(log => {
      const ts = log.t ? new Date(log.t * 1000).toISOString() : ''
      return `[${ts}] [${log.node}] [${log.level || 'info'}] ${log.msg || log.message || ''}`
    }).join('\n')
    
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-1 flex-wrap">
          <div className="relative flex-1 max-w-[300px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Cerca messaggio..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <select
            value={filterNode}
            onChange={(e) => setFilterNode(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Tutti i nodi</option>
            {allNodes.map(node => (
              <option key={node} value={node}>{node}</option>
            ))}
          </select>
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="">Tutti i livelli</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <X size={14} />
              Pulisci
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-cyan-500"
            />
            Auto-scroll
          </label>
          <button
            onClick={exportLogs}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Download size={16} />
            Esporta
          </button>
          <button
            onClick={() => refetch()}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            Aggiorna
          </button>
        </div>
      </div>

      {hasActiveFilters && (
        <p className="text-xs text-gray-500">
          Mostrando {filteredLogs.length} di {logs.length} entries
        </p>
      )}

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader>
          <span>Syslog Cluster ({filteredLogs.length} entries)</span>
        </CardHeader>
        <CardBody className="flex-1 overflow-auto p-0">
          <div className="font-mono text-xs space-y-0.5 p-4" ref={(el) => {
            if (el && autoScroll) {
              el.scrollTop = el.scrollHeight
            }
          }}>
            {filteredLogs.map((log, i) => (
              <div
                key={i}
                className={`flex gap-3 py-1 px-2 rounded ${getLevelBg(log.level)}`}
              >
                <span className="text-gray-500 whitespace-nowrap">
                  {log.t ? new Date(log.t * 1000).toLocaleTimeString('it-IT') : '-'}
                </span>
                <span className="text-purple-400 whitespace-nowrap w-24 truncate">
                  {log.node || '-'}
                </span>
                <span className={`whitespace-nowrap w-10 ${getLevelColor(log.level)}`}>
                  {((log.level || log.pri || 'info') + '').toUpperCase().slice(0, 4)}
                </span>
                <span className="text-gray-300 break-all">
                  {log.msg || log.message || log.t || '-'}
                </span>
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                {logs.length === 0 ? 'Nessun log disponibile' : 'Nessun log corrisponde ai filtri'}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
