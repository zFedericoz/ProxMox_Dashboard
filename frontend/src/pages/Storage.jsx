import { useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { HardDrive, Search, ChevronUp, ChevronDown, Filter, X } from 'lucide-react'

const fmt = {
  bytes: (b) => {
    if (!b) return '0 B'
    const u = ['B','KB','MB','GB','TB']
    let i = 0
    while (b >= 1024 && i < u.length-1) { b /= 1024; i++ }
    return `${b.toFixed(1)} ${u[i]}`
  }
}

export function Storage() {
  const { data: storageData, refetch } = useApi('/api/storage', { refetchInterval: 60000 })
  
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [filterNode, setFilterNode] = useState('')
  const [filterType, setFilterType] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'storage', direction: 'asc' })

  const storages = storageData?.storage || []

  const allNodes = useMemo(() => {
    return Array.from(new Set(storages.map(s => s.node))).sort()
  }, [storages])

  const allTypes = useMemo(() => {
    return Array.from(new Set(storages.map(s => s.type).filter(Boolean))).sort()
  }, [storages])

  const getUtilizationColor = (pct) => {
    if (pct > 90) return 'bg-red-500'
    if (pct > 75) return 'bg-yellow-500'
    return 'bg-cyan-500'
  }

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

  const filteredAndSorted = useMemo(() => {
    let result = [...storages]

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(item =>
        (item.storage || '').toLowerCase().includes(s) ||
        (item.id || '').toLowerCase().includes(s)
      )
    }

    if (filterNode) {
      result = result.filter(item => item.node === filterNode)
    }

    if (filterType) {
      result = result.filter(item => item.type === filterType)
    }

    result.sort((a, b) => {
      let aVal = a[sortConfig.key] || ''
      let bVal = b[sortConfig.key] || ''
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [storages, search, filterNode, filterType, sortConfig])

  const clearFilters = () => {
    setSearch('')
    setFilterNode('')
    setFilterType('')
  }

  const hasActiveFilters = search || filterNode || filterType

  const totalUsed = useMemo(() => {
    return filteredAndSorted.reduce((acc, s) => {
      const used = s.disk_used || s.used || 0
      return acc + used
    }, 0)
  }, [filteredAndSorted])

  const totalSize = useMemo(() => {
    return filteredAndSorted.reduce((acc, s) => {
      const total = s.total || s.maxdisk || 0
      return acc + total
    }, 0)
  }, [filteredAndSorted])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
              <HardDrive size={14} />
              <span>Storage Totale</span>
            </div>
            <p className="text-2xl font-bold font-mono text-white">{filteredAndSorted.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
              <span>Spazio Usato</span>
            </div>
            <p className="text-2xl font-bold font-mono text-cyan-400">{fmt.bytes(totalUsed)}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
              <span>Spazio Totale</span>
            </div>
            <p className="text-2xl font-bold font-mono text-purple-400">{fmt.bytes(totalSize)}</p>
          </div>
        </div>
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
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 mb-1">Cerca</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Nome storage..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
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
            <label className="block text-xs text-gray-400 mb-1">Tipo</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">Tutti</option>
              {allTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
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
          Mostrando {filteredAndSorted.length} di {storages.length} storage
        </p>
      )}

      <Card noPadding>
        <CardHeader>
          <span>Storage Cluster ({filteredAndSorted.length})</span>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('node')}>
                  <span className="flex items-center gap-1">Nodo <SortIcon column="node" /></span>
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('storage')}>
                  <span className="flex items-center gap-1">Storage <SortIcon column="storage" /></span>
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('type')}>
                  <span className="flex items-center gap-1">Tipo <SortIcon column="type" /></span>
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-cyan-400" onClick={() => handleSort('state')}>
                  <span className="flex items-center gap-1">Stato <SortIcon column="state" /></span>
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Usato</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Totale</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utilizzo</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Content</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredAndSorted.map((storage, i) => {
                const used = storage.disk_used || storage.used || 0
                const total = storage.total || storage.maxdisk || 1
                const pct = Math.round((used / total) * 100)
                
                return (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-mono text-cyan-400">{storage.node}</td>
                    <td className="px-4 py-3 font-mono text-white">{storage.storage || storage.id}</td>
                    <td className="px-4 py-3 text-gray-400">{storage.type || '-'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={storage.enabled || storage.active === 1 ? 'enabled' : 'disabled'} />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">{fmt.bytes(used)}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{fmt.bytes(total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full ${getUtilizationColor(pct)} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-xs text-gray-400">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{storage.content || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredAndSorted.length === 0 && (
            <div className="p-8 text-center text-gray-500">Nessuno storage trovato</div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
