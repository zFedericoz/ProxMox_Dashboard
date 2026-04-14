import { useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { Cpu, HardDrive, Search, ChevronUp, ChevronDown, Filter, X, AlertCircle } from 'lucide-react'

export function Services() {
  const { data, loading, error, refetch } = useApi('/api/services', { refetchInterval: 60000 })
  
  const services = useMemo(() => {
    if (!data) return {}
    return data.services || {}
  }, [data])

  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [filterNode, setFilterNode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' })

  const allServices = useMemo(() => {
    if (!services || typeof services !== 'object') return []
    try {
      return Object.entries(services).flatMap(([node, nodeServices]) =>
        (nodeServices || []).map(s => ({ ...s, node }))
      )
    } catch (e) {
      console.error('Error parsing services:', e)
      return []
    }
  }, [services])

  const allNodes = useMemo(() => {
    try {
      return Array.from(new Set(allServices.map(s => s.node).filter(Boolean))).sort()
    } catch (e) {
      return []
    }
  }, [allServices])

  const running = useMemo(() => {
    try {
      return allServices.filter(s => s.state === 'running').length
    } catch (e) {
      return 0
    }
  }, [allServices])

  const stopped = useMemo(() => {
    try {
      return allServices.filter(s => s.state === 'stopped').length
    } catch (e) {
      return 0
    }
  }, [allServices])

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
    try {
      let result = [...allServices]

      if (search) {
        const s = search.toLowerCase()
        result = result.filter(item =>
          (item.name || '').toLowerCase().includes(s) ||
          (item.service || '').toLowerCase().includes(s) ||
          (item.desc || '').toLowerCase().includes(s)
        )
      }

      if (filterNode) {
        result = result.filter(item => item.node === filterNode)
      }

      if (filterStatus) {
        result = result.filter(item => item.state === filterStatus)
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
    } catch (e) {
      console.error('Error filtering services:', e)
      return []
    }
  }, [allServices, search, filterNode, filterStatus, sortConfig])

  const clearFilters = () => {
    setSearch('')
    setFilterNode('')
    setFilterStatus('')
  }

  const hasActiveFilters = search || filterNode || filterStatus

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
          <p className="text-red-400 mb-2">Errore nel caricamento dei servizi</p>
          <p className="text-gray-500 text-sm">{error}</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-cyan-500 text-gray-900 rounded-lg">
            Riprova
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
              <Cpu size={14} />
              <span>Totale Servizi</span>
            </div>
            <p className="text-2xl font-bold font-mono text-white">{allServices.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-500 text-xs mb-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span>Attivi</span>
            </div>
            <p className="text-2xl font-bold font-mono text-green-400">{running}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-500 text-xs mb-2">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span>Fermi</span>
            </div>
            <p className="text-2xl font-bold font-mono text-red-400">{stopped}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
              <HardDrive size={14} />
              <span>Nodi</span>
            </div>
            <p className="text-2xl font-bold font-mono text-white">{Object.keys(services).length}</p>
          </div>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            showFilters ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Filter size={16} />
          Filtri
        </button>
      </div>

      {showFilters && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-400 mb-1">Cerca</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Nome o descrizione..."
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
            <label className="block text-xs text-gray-400 mb-1">Stato</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">Tutti</option>
              <option value="running">Running</option>
              <option value="stopped">Stopped</option>
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
          Mostrando {filteredAndSorted.length} di {allServices.length} servizi
        </p>
      )}

      <Card noPadding>
        <CardHeader>Servizi di Sistema ({filteredAndSorted.length})</CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('node')}>
                    <span className="flex items-center gap-1">Nodo <SortIcon column="node" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('name')}>
                    <span className="flex items-center gap-1">Servizio <SortIcon column="name" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('state')}>
                    <span className="flex items-center gap-1">Stato <SortIcon column="state" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('desc')}>
                    <span className="flex items-center gap-1">Descrizione <SortIcon column="desc" /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredAndSorted.map((service, i) => (
                  <tr key={i} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-cyan-400">{service.node}</td>
                    <td className="px-4 py-3 text-white font-medium">{service.name || service.service}</td>
                    <td className="px-4 py-3"><StatusBadge status={service.state || service.status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-sm">{service.desc || service.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAndSorted.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                Nessun servizio trovato
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
