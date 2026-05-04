import { useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { formatDate } from '../utils/dateUtils'
import { Activity, Search, ChevronUp, ChevronDown, Filter, X } from 'lucide-react'

export function Activities() {
  const { data: tasksData, refetch: refetchTasks } = useApi('/api/tasks', { params: { limit: 50 }, refetchInterval: 30000 })
  const { data: actData, refetch: refetchActs } = useApi('/api/logs/activity', { params: { limit: 50 }, refetchInterval: 30000 })

  const [showFilters, setShowFilters] = useState(false)
  const [filterNode, setFilterNode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'starttime', direction: 'desc' })

  const tasks = tasksData?.tasks || []
  const activities = actData?.logs || []

  const allNodes = useMemo(() => {
    return Array.from(new Set(tasks.map(t => t.node).filter(Boolean))).sort()
  }, [tasks])

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ChevronUp size={12} className="opacity-30" />
    return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-cyan-400" /> : <ChevronDown size={12} className="text-cyan-400" />
  }

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  const filteredTasks = useMemo(() => {
    let result = [...tasks]

    if (filterNode) {
      result = result.filter(item => item.node === filterNode)
    }

    if (filterStatus) {
      result = result.filter(item => item.status === filterStatus)
    }

    result.sort((a, b) => {
      let aVal = a[sortConfig.key]
      let bVal = b[sortConfig.key]
      if (aVal === undefined || aVal === null) aVal = 0
      if (bVal === undefined || bVal === null) bVal = 0
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [tasks, filterNode, filterStatus, sortConfig])

  const clearFilters = () => {
    setFilterNode('')
    setFilterStatus('')
  }

  const hasActiveFilters = filterNode || filterStatus

  const refetch = () => {
    refetchTasks()
    refetchActs()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              showFilters ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Filter size={16} />
            Filtri
          </button>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Aggiorna
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <div className="w-40">
            <label className="block text-xs text-gray-400 mb-1">Nodo</label>
            <select
              value={filterNode}
              onChange={(e) => setFilterNode(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">Tutti</option>
              {allNodes.map(node => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="block text-xs text-gray-400 mb-1">Stato</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">Tutti</option>
              <option value="running">Running</option>
              <option value="ok">OK</option>
              <option value="error">Error</option>
            </select>
          </div>
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
      )}

      {hasActiveFilters && (
        <p className="text-xs text-gray-500">
          Mostrando {filteredTasks.length} di {tasks.length} task
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card noPadding>
          <CardHeader>Task Proxmox Recenti ({filteredTasks.length})</CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('node')}>
                      <span className="flex items-center gap-1">Nodo <SortIcon column="node" /></span>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('type')}>
                      <span className="flex items-center gap-1">Tipo <SortIcon column="type" /></span>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('status')}>
                      <span className="flex items-center gap-1">Stato <SortIcon column="status" /></span>
                    </th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('starttime')}>
                      <span className="flex items-center gap-1">Tempo <SortIcon column="starttime" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {filteredTasks.map((task, i) => (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-mono text-cyan-400">{task.node}</td>
                      <td className="px-4 py-3 text-white">{task.type || 'task'}</td>
                      <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                      <td className="px-4 py-3 font-mono text-gray-400">{task.user || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {task.starttime ? formatDate(task.starttime) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTasks.length === 0 && (
                <div className="p-8 text-center text-gray-500">Nessun task recente</div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card noPadding>
          <CardHeader>Attivita Dashboard ({activities.length})</CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timestamp</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azione</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {activities.map((act, i) => (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {act.timestamp ? formatDate(act.timestamp) : '-'}
                      </td>
                      <td className="px-4 py-3 text-cyan-400">{act.user}</td>
                      <td className="px-4 py-3 text-white">{act.action}</td>
                      <td className="px-4 py-3"><StatusBadge status={act.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activities.length === 0 && (
                <div className="p-8 text-center text-gray-500">Nessuna attivita recente</div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
