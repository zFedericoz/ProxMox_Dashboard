import { useState, useMemo, useEffect } from 'react'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody, CardStat } from '../components/ui/Card'
import { StatusBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { ConfirmModal, Modal } from '../components/ui/Modal'
import { Download, Upload, Server, Cpu, HardDrive, MemoryStick, Clock, RefreshCw, Search, ChevronUp, ChevronDown, Filter, X, ArrowRight, Layers } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const fmt = {
  bytes: (b) => {
    if (!b) return '0 B'
    const u = ['B','KB','MB','GB','TB']
    let i = 0
    while (b >= 1024 && i < u.length-1) { b /= 1024; i++ }
    return `${b.toFixed(1)} ${u[i]}`
  },
  pct: (v) => `${(v||0).toFixed(1)}%`,
  uptime: (s) => {
    if (!s) return 'N/A'
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60)
    if (d>0) return `${d}g ${h}h`
    if (h>0) return `${h}h ${m}m`
    return `${m}m`
  }
}

export function Resources() {
  const { data: clustersData } = useApi('/api/clusters', { refetchInterval: 30000 })
  const [selectedClusterId, setSelectedClusterId] = useState(null)
  const clusters = clustersData?.clusters || []

  // Auto-select first cluster when clusters load
  useEffect(() => {
    if (clusters.length > 0 && selectedClusterId === null) {
      setSelectedClusterId(clusters[0].id)
    }
  }, [clusters])

  const apiEndpoint = selectedClusterId
    ? `/api/cluster/all?cluster_id=${selectedClusterId}`
    : '/api/cluster/all'
  const { data, loading, error, refetch } = useApi(apiEndpoint, { refetchInterval: 60000 })
  const { execute: apiExecute } = useApiAction()
  const toast = useToast()
  
  const [activeTab, setActiveTab] = useState('vms')
  const [selectedVm, setSelectedVm] = useState(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [actionToConfirm, setActionToConfirm] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [search, setSearch] = useState('')
  const [filterNode, setFilterNode] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: 'vmid', direction: 'asc' })
  const [showMigrateModal, setShowMigrateModal] = useState(false)
  const [migrateTarget, setMigrateTarget] = useState('')
  const [migrateOnline, setMigrateOnline] = useState(true)
  const [migrating, setMigrating] = useState(false)

  const vms = data?.vms || []
  const containers = data?.containers || []

  const allNodes = useMemo(() => {
    const nodes = new Set([...vms, ...containers].map(item => item.node))
    return Array.from(nodes).sort()
  }, [vms, containers])

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
    const items = activeTab === 'vms' ? vms : containers
    let result = [...items]

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(item =>
        (item.name || '').toLowerCase().includes(s) ||
        String(item.vmid).includes(s)
      )
    }

    if (filterNode) {
      result = result.filter(item => item.node === filterNode)
    }

    if (filterStatus) {
      result = result.filter(item => item.status === filterStatus)
    }

    result.sort((a, b) => {
      let aVal = a[sortConfig.key]
      let bVal = b[sortConfig.key]
      if (typeof aVal === 'string') aVal = aVal.toLowerCase()
      if (typeof bVal === 'string') bVal = bVal.toLowerCase()
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [vms, containers, activeTab, search, filterNode, filterStatus, sortConfig])

  const clearFilters = () => {
    setSearch('')
    setFilterNode('')
    setFilterStatus('')
  }

  const hasActiveFilters = search || filterNode || filterStatus

  const handlePowerAction = async (type, node, vmid, action) => {
    const endpoint = type === 'vm' 
      ? `/api/vms/${node}/${vmid}/${action}`
      : `/api/containers/${node}/${vmid}/${action}`
    
    const result = await apiExecute(endpoint, 'POST')
    if (result.success) {
      toast.success(`Azione ${action} inviata`)
      setTimeout(() => refetch(), 2000)
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const confirmAction = () => {
    if (!actionToConfirm) return
    const { type, node, vmid, action } = actionToConfirm
    setActionLoading(true)
    handlePowerAction(type, node, vmid, action)
      .finally(() => {
        setActionLoading(false)
        setShowConfirmModal(false)
        setActionToConfirm(null)
      })
  }

  const requestAction = (type, node, vmid, action, name) => {
    if (['stop', 'shutdown'].includes(action)) {
      setActionToConfirm({ type, node, vmid, action, name })
      setShowConfirmModal(true)
    } else {
      handlePowerAction(type, node, vmid, action)
    }
  }

  const exportToCsv = (items, filename) => {
    if (!items.length) return
    const headers = Object.keys(items[0]).join(',')
    const rows = items.map(item => Object.values(item).join(','))
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Esportazione completata')
  }

  const handleMigrate = async () => {
    if (!selectedVm || !migrateTarget) {
      toast.error('Seleziona il nodo target')
      return
    }
    setMigrating(true)
    const endpoint = activeTab === 'vms' 
      ? `/api/vms/${selectedVm.node}/${selectedVm.vmid}/migrate`
      : `/api/containers/${selectedVm.node}/${selectedVm.vmid}/migrate`
    
    const result = await apiExecute(endpoint, 'POST', {
      target_node: migrateTarget,
      online: migrateOnline
    })
    
    setMigrating(false)
    if (result.success) {
      toast.success(`Migrazione di ${selectedVm.name} verso ${migrateTarget} avviata`)
      setShowMigrateModal(false)
      setSelectedVm(null)
      setTimeout(() => refetch(), 3000)
    } else {
      toast.error(result.error || 'Errore migrazione')
    }
  }

  const openMigrateModal = (vm, type) => {
    setSelectedVm(vm)
    setActiveTab(type)
    const otherNodes = allNodes.filter(n => n !== vm.node)
    setMigrateTarget(otherNodes[0] || '')
    setShowMigrateModal(true)
  }

  const QuickActions = ({ vm, type }) => {
    const isRunning = vm.status === 'running'
    const isStopped = vm.status === 'stopped' || vm.status === 'paused'
    const otherNodes = allNodes.filter(n => n !== vm.node)
    const canMigrate = otherNodes.length > 0
    
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => requestAction(type, vm.node, vm.vmid, 'start', vm.name)}
          disabled={isRunning}
          className="p-1.5 rounded hover:bg-green-900/50 text-green-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Avvia"
        >
          <Download size={14} />
        </button>
        <button
          onClick={() => requestAction(type, vm.node, vm.vmid, 'shutdown', vm.name)}
          disabled={isStopped}
          className="p-1.5 rounded hover:bg-yellow-900/50 text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Spegni"
        >
          <Upload size={14} />
        </button>
        <button
          onClick={() => requestAction(type, vm.node, vm.vmid, 'stop', vm.name)}
          disabled={isStopped}
          className="p-1.5 rounded hover:bg-red-900/50 text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Stop forzato"
        >
          <Server size={14} />
        </button>
        <button
          onClick={() => requestAction(type, vm.node, vm.vmid, 'reboot', vm.name)}
          disabled={isStopped}
          className="p-1.5 rounded hover:bg-cyan-900/50 text-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Riavvia"
        >
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => openMigrateModal(vm, type)}
          disabled={!canMigrate}
          className="p-1.5 rounded hover:bg-purple-900/50 text-purple-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Migra"
        >
          <ArrowRight size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cluster tabs */}
      {clusters.length > 0 && (
        <div className="flex gap-1 border-b border-gray-800 overflow-x-auto">
          {clusters.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedClusterId(c.id)}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                c.id === selectedClusterId
                  ? 'border-cyan-400 text-white bg-gray-800/40'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/20'
              }`}
            >
              <Layers size={14} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('vms')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'vms' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            VM ({vms.length})
          </button>
          <button
            onClick={() => setActiveTab('containers')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'containers' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Container LXC ({containers.length})
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            variant={showFilters ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            icon={<Filter size={16} />}
          >
            Filtri
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportToCsv(activeTab === 'vms' ? vms : containers, `${activeTab}_export`)}
          >
            Esporta CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Aggiorna
          </Button>
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
                placeholder="Nome o ID..."
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
              <option value="paused">Paused</option>
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
          Mostrando {filteredAndSorted.length} di {activeTab === 'vms' ? vms.length : containers.length} {activeTab === 'vms' ? 'VM' : 'container'}
        </p>
      )}

      <Card noPadding>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('vmid')}>
                    <span className="flex items-center gap-1">ID <SortIcon column="vmid" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('name')}>
                    <span className="flex items-center gap-1">Nome <SortIcon column="name" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('node')}>
                    <span className="flex items-center gap-1">Nodo <SortIcon column="node" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('status')}>
                    <span className="flex items-center gap-1">Stato <SortIcon column="status" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('cpus')}>
                    <span className="flex items-center gap-1">vCPU <SortIcon column="cpus" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('maxmem')}>
                    <span className="flex items-center gap-1">RAM <SortIcon column="maxmem" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('maxdisk')}>
                    <span className="flex items-center gap-1">Disco <SortIcon column="maxdisk" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-cyan-400" onClick={() => handleSort('uptime')}>
                    <span className="flex items-center gap-1">Uptime <SortIcon column="uptime" /></span>
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredAndSorted.map((vm) => (
                  <tr key={`${vm.node}-${vm.vmid}`} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-cyan-400">{vm.vmid}</td>
                    <td className="px-4 py-3 text-white font-medium">{vm.name || vm.vmid}</td>
                    <td className="px-4 py-3 font-mono text-gray-400">{vm.node}</td>
                    <td className="px-4 py-3"><StatusBadge status={vm.status} /></td>
                    <td className="px-4 py-3 font-mono text-gray-300">{vm.cpus || vm.cpu || '-'}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{fmt.bytes(vm.maxmem)}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{fmt.bytes(vm.maxdisk)}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{fmt.uptime(vm.uptime)}</td>
                    <td className="px-4 py-3">
                      <QuickActions vm={vm} type={activeTab === 'vms' ? 'vm' : 'ct'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredAndSorted.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                Nessuna {activeTab === 'vms' ? 'VM' : 'container'} trovata
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Modal
        isOpen={showMigrateModal}
        onClose={() => setShowMigrateModal(false)}
        title={`Migra ${selectedVm?.name || 'VM'}`}
      >
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Nodo sorgente:</span>
              <span className="text-cyan-400 font-mono">{selectedVm?.node}</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-400">Stato:</span>
              <StatusBadge status={selectedVm?.status} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Nodo Target</label>
            <select
              value={migrateTarget}
              onChange={(e) => setMigrateTarget(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
            >
              {allNodes.filter(n => n !== selectedVm?.node).map(node => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={migrateOnline}
              onChange={(e) => setMigrateOnline(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-cyan-500"
            />
            Migrazione online (senza spegnere la VM)
          </label>

          {!migrateOnline && selectedVm?.status === 'running' && (
            <p className="text-xs text-yellow-400">
              La VM verra spenta prima della migrazione e riaccesa al termine.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowMigrateModal(false)}>
              Annulla
            </Button>
            <Button onClick={handleMigrate} loading={migrating} icon={<ArrowRight size={16} />}>
              Avvia Migrazione
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={showConfirmModal}
        onClose={() => { setShowConfirmModal(false); setActionToConfirm(null); }}
        onConfirm={confirmAction}
        title="Conferma Azione"
        message={`Sei sicuro di voler eseguire "${actionToConfirm?.action}" su "${actionToConfirm?.name}"?`}
        loading={actionLoading}
      />
    </div>
  )
}
