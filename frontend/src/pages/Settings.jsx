import { useEffect, useState } from 'react'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { Modal } from '../components/ui/Modal'
import {
  Plus, Edit2, Trash2, Server, Wifi, WifiOff, Save,
  Layers, ChevronDown, ChevronRight, Link, Unlink, Network
} from 'lucide-react'

export function Settings() {
  const toast = useToast()
  const { execute: apiExecute } = useApiAction()

  const { data: nodesData, refetch: refetchNodes } = useApi('/api/nodes')
  const { data: clusterData } = useApi('/api/cluster/nodes')
  const { data: clustersData, refetch: refetchClusters } = useApi('/api/clusters')

  const [nodes, setNodes] = useState([])
  const [clusters, setClusters] = useState([])
  const [standaloneNodes, setStandaloneNodes] = useState([])
  const clusterNodes = clusterData?.nodes || []

  // Node modal
  const [showNodeModal, setShowNodeModal] = useState(false)
  const [editingNode, setEditingNode] = useState(null)
  const [showDeleteNodeModal, setShowDeleteNodeModal] = useState(false)
  const [nodeToDelete, setNodeToDelete] = useState(null)

  // Cluster modal
  const [showClusterModal, setShowClusterModal] = useState(false)
  const [editingCluster, setEditingCluster] = useState(null)
  const [showDeleteClusterModal, setShowDeleteClusterModal] = useState(false)
  const [clusterToDelete, setClusterToDelete] = useState(null)

  // Assign modal
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigningNode, setAssigningNode] = useState(null)

  // Expanded clusters
  const [expandedClusters, setExpandedClusters] = useState({})

  const [nodeForm, setNodeForm] = useState({ name: '', host: '', port: 8006, timeout: 8, zone: 'Default' })
  const [clusterForm, setClusterForm] = useState({ name: '', description: '' })

  useEffect(() => {
    if (nodesData?.nodes) setNodes(nodesData.nodes)
  }, [nodesData])

  useEffect(() => {
    if (clustersData) {
      setClusters(clustersData.clusters || [])
      setStandaloneNodes(clustersData.standalone_nodes || [])
    }
  }, [clustersData])

  const refetchAll = () => { refetchNodes(); refetchClusters() }

  // ── Node handlers ──────────────────────────────────────────────────────────
  const openAddNode = () => {
    setNodeForm({ name: '', host: '', port: 8006, timeout: 8, zone: 'Default' })
    setEditingNode(null)
    setShowNodeModal(true)
  }

  const openEditNode = (node) => {
    setNodeForm({ name: node.name, host: node.host, port: node.port || 8006, timeout: node.timeout || 8, zone: node.zone || 'Default' })
    setEditingNode(node)
    setShowNodeModal(true)
  }

  const handleSaveNode = async () => {
    if (!nodeForm.name || !nodeForm.host) { toast.error('Nome e Host sono obbligatori'); return }
    const method = editingNode ? 'PUT' : 'POST'
    const url = editingNode ? `/api/nodes/${editingNode.name}` : '/api/nodes'
    const result = await apiExecute(url, method, nodeForm)
    if (result.success) {
      toast.success(editingNode ? 'Nodo aggiornato' : 'Nodo aggiunto')
      setShowNodeModal(false)
      refetchAll()
    } else {
      toast.error(result.error || 'Errore salvataggio')
    }
  }

  const handleDeleteNode = async () => {
    if (!nodeToDelete) return
    const result = await apiExecute(`/api/nodes/${nodeToDelete.name}`, 'DELETE')
    if (result.success) {
      toast.success('Nodo eliminato')
      setShowDeleteNodeModal(false)
      setNodeToDelete(null)
      refetchAll()
    } else {
      toast.error(result.error || 'Errore eliminazione')
    }
  }

  const handleToggleNode = async (node) => {
    const next = !node.enabled
    setNodes(prev => prev.map(n => n.name === node.name ? { ...n, enabled: next } : n))
    const result = await apiExecute(`/api/nodes/${node.name}`, 'PUT', { enabled: next })
    if (result.success) {
      toast.success(`Nodo ${next ? 'abilitato' : 'disabilitato'}`)
      refetchAll()
    } else {
      setNodes(prev => prev.map(n => n.name === node.name ? { ...n, enabled: !next } : n))
      toast.error(result.error || 'Errore aggiornamento')
    }
  }

  // ── Cluster handlers ───────────────────────────────────────────────────────
  const openAddCluster = () => {
    setClusterForm({ name: '', description: '' })
    setEditingCluster(null)
    setShowClusterModal(true)
  }

  const openEditCluster = (c) => {
    setClusterForm({ name: c.name, description: c.description || '' })
    setEditingCluster(c)
    setShowClusterModal(true)
  }

  const handleSaveCluster = async () => {
    if (!clusterForm.name.trim()) { toast.error('Il nome cluster è obbligatorio'); return }
    const method = editingCluster ? 'PUT' : 'POST'
    const url = editingCluster ? `/api/clusters/${editingCluster.id}` : '/api/clusters'
    const result = await apiExecute(url, method, clusterForm)
    if (result.success) {
      toast.success(editingCluster ? 'Cluster aggiornato' : 'Cluster creato')
      setShowClusterModal(false)
      refetchClusters()
    } else {
      toast.error(result.error || 'Errore salvataggio')
    }
  }

  const handleDeleteCluster = async () => {
    if (!clusterToDelete) return
    const result = await apiExecute(`/api/clusters/${clusterToDelete.id}`, 'DELETE')
    if (result.success) {
      toast.success('Cluster eliminato')
      setShowDeleteClusterModal(false)
      setClusterToDelete(null)
      refetchAll()
    } else {
      toast.error(result.error || 'Errore eliminazione')
    }
  }

  // ── Assign handlers ────────────────────────────────────────────────────────
  const openAssign = (node) => {
    setAssigningNode(node)
    setShowAssignModal(true)
  }

  const handleAssign = async (clusterId) => {
    const url = clusterId
      ? `/api/clusters/${clusterId}/nodes/${assigningNode.name}`
      : `/api/clusters/${assigningNode.cluster_id}/nodes/${assigningNode.name}`
    const method = clusterId ? 'PUT' : 'DELETE'
    const result = await apiExecute(url, method)
    if (result.success) {
      toast.success(clusterId ? 'Nodo assegnato al cluster' : 'Nodo rimosso dal cluster')
      setShowAssignModal(false)
      refetchAll()
    } else {
      toast.error(result.error || 'Errore assegnazione')
    }
  }

  const getNodeStatus = (nodeName) => clusterNodes.find(n => n.name === nodeName)?.status || 'offline'

  const toggleExpand = (id) => setExpandedClusters(prev => ({ ...prev, [id]: !prev[id] }))

  // ── Node row ───────────────────────────────────────────────────────────────
  const NodeRow = ({ node, insideCluster = false }) => {
    const status = getNodeStatus(node.name)
    const fullNode = nodes.find(n => n.name === node.name) || node
    return (
      <tr className="hover:bg-gray-800/50">
        <td className="px-4 py-3">
          {status === 'online'
            ? <Wifi size={14} className="text-green-400" />
            : status === 'offline'
            ? <WifiOff size={14} className="text-red-400" />
            : <RefreshCw size={14} className="text-gray-400 animate-spin" />}
        </td>
        <td className="px-4 py-3 font-mono text-cyan-400 font-medium">{node.name}</td>
        <td className="px-4 py-3 font-mono text-gray-300">{node.host}</td>
        <td className="px-4 py-3 font-mono text-gray-400">{node.port || 8006}</td>
        <td className="px-4 py-3 text-purple-400">{node.zone || 'Default'}</td>
        <td className="px-4 py-3">
          <button
            onClick={() => handleToggleNode(fullNode)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${fullNode.enabled ? 'bg-cyan-500' : 'bg-gray-700'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${fullNode.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button onClick={() => openAssign(node)} className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors" title="Assegna a cluster">
              <Network size={14} />
            </button>
            <button onClick={() => openEditNode(fullNode)} className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded transition-colors" title="Modifica">
              <Edit2 size={14} />
            </button>
            <button onClick={() => { setNodeToDelete(node); setShowDeleteNodeModal(true) }} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors" title="Elimina">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Impostazioni</h1>
          <p className="text-sm text-gray-400 mt-1">Gestisci cluster e nodi Proxmox</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openAddCluster} icon={<Layers size={16} />}>
            Aggiungi Cluster
          </Button>
          <Button onClick={openAddNode} icon={<Plus size={16} />}>
            Aggiungi Nodo
          </Button>
        </div>
      </div>

      {/* Clusters */}
      {clusters.map(c => (
        <Card key={c.id} noPadding>
          <div
            className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-800/30"
            onClick={() => toggleExpand(c.id)}
          >
            <div className="flex items-center gap-3">
              {expandedClusters[c.id]
                ? <ChevronDown size={16} className="text-gray-400" />
                : <ChevronRight size={16} className="text-gray-400" />}
              <Layers size={18} className="text-cyan-400" />
              <div>
                <span className="font-semibold text-white">{c.name}</span>
                {c.description && <span className="ml-2 text-xs text-gray-500">{c.description}</span>}
                <span className="ml-3 text-xs text-gray-500">{c.node_count || 0} nodi</span>
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => openEditCluster(c)} className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded transition-colors" title="Modifica cluster">
                <Edit2 size={14} />
              </button>
              <button onClick={() => { setClusterToDelete(c); setShowDeleteClusterModal(true) }} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors" title="Elimina cluster">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {expandedClusters[c.id] && (
            <div className="border-t border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Nome</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Host</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Porta</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Zona</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Abilitato</th>
                    <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {c.nodes?.length > 0
                    ? c.nodes.map(n => <NodeRow key={n.name} node={n} insideCluster />)
                    : (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-sm">
                        Nessun nodo in questo cluster — usa il pulsante <Network size={12} className="inline" /> su un nodo per assegnarlo
                      </td></tr>
                    )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}

      {/* Standalone nodes */}
      <Card noPadding>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server size={16} className="text-gray-400" />
            <span>Nodi Standalone</span>
            <span className="text-xs text-gray-500 font-normal ml-1">({standaloneNodes.length} nodi senza cluster)</span>
          </div>
        </CardHeader>
        <div className="border-t border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Nome</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Host</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Porta</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Zona</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Abilitato</th>
                <th className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {standaloneNodes.length > 0
                ? standaloneNodes.map(n => <NodeRow key={n.name} node={n} />)
                : (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    <Server size={36} className="mx-auto mb-3 opacity-30" />
                    <p>Tutti i nodi sono assegnati a un cluster</p>
                  </td></tr>
                )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Info card */}
      <Card>
        <CardHeader>Stato Generale</CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Cluster" value={clusters.length} color="cyan" />
            <Stat label="Nodi totali" value={nodes.length} color="purple" />
            <Stat label="Online" value={clusterNodes.filter(n => n.status === 'online').length} color="green" />
            <Stat label="Offline" value={clusterNodes.filter(n => n.status === 'offline').length} color="red" />
          </div>
        </CardBody>
      </Card>

      {/* ── Modals ── */}

      {/* Node modal */}
      <Modal isOpen={showNodeModal} onClose={() => setShowNodeModal(false)} title={editingNode ? 'Modifica Nodo' : 'Aggiungi Nodo'}>
        <div className="space-y-4">
          <Field label="Nome Nodo *">
            <input type="text" value={nodeForm.name} disabled={!!editingNode}
              onChange={e => setNodeForm({ ...nodeForm, name: e.target.value })}
              placeholder="es. pve-node1" className={inputCls + (editingNode ? ' opacity-50' : '')} />
          </Field>
          <Field label="Host/IP *">
            <input type="text" value={nodeForm.host}
              onChange={e => setNodeForm({ ...nodeForm, host: e.target.value })}
              placeholder="es. 192.168.1.100" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Porta API">
              <input type="number" value={nodeForm.port}
                onChange={e => setNodeForm({ ...nodeForm, port: parseInt(e.target.value) || 8006 })} className={inputCls} />
            </Field>
            <Field label="Timeout (sec)">
              <input type="number" value={nodeForm.timeout}
                onChange={e => setNodeForm({ ...nodeForm, timeout: parseInt(e.target.value) || 8 })} className={inputCls} />
            </Field>
          </div>
          <Field label="Zona">
            <input type="text" value={nodeForm.zone}
              onChange={e => setNodeForm({ ...nodeForm, zone: e.target.value })}
              placeholder="es. Produzione" className={inputCls} />
          </Field>
          <ModalFooter onCancel={() => setShowNodeModal(false)} onConfirm={handleSaveNode}
            confirmLabel={editingNode ? 'Salva Modifiche' : 'Aggiungi Nodo'} />
        </div>
      </Modal>

      {/* Delete node modal */}
      <Modal isOpen={showDeleteNodeModal} onClose={() => setShowDeleteNodeModal(false)} title="Elimina Nodo">
        <div className="space-y-4">
          <p className="text-gray-300">Eliminare il nodo <span className="text-cyan-400 font-mono">{nodeToDelete?.name}</span>?</p>
          <ModalFooter onCancel={() => setShowDeleteNodeModal(false)} onConfirm={handleDeleteNode}
            confirmLabel="Elimina" confirmVariant="danger" />
        </div>
      </Modal>

      {/* Cluster modal */}
      <Modal isOpen={showClusterModal} onClose={() => setShowClusterModal(false)} title={editingCluster ? 'Modifica Cluster' : 'Nuovo Cluster'}>
        <div className="space-y-4">
          <Field label="Nome Cluster *">
            <input type="text" value={clusterForm.name}
              onChange={e => setClusterForm({ ...clusterForm, name: e.target.value })}
              placeholder="es. Cluster Produzione" className={inputCls} />
          </Field>
          <Field label="Descrizione">
            <input type="text" value={clusterForm.description}
              onChange={e => setClusterForm({ ...clusterForm, description: e.target.value })}
              placeholder="es. Nodi datacenter principale" className={inputCls} />
          </Field>
          <ModalFooter onCancel={() => setShowClusterModal(false)} onConfirm={handleSaveCluster}
            confirmLabel={editingCluster ? 'Salva' : 'Crea Cluster'} />
        </div>
      </Modal>

      {/* Delete cluster modal */}
      <Modal isOpen={showDeleteClusterModal} onClose={() => setShowDeleteClusterModal(false)} title="Elimina Cluster">
        <div className="space-y-4">
          <p className="text-gray-300">Eliminare il cluster <span className="text-cyan-400">{clusterToDelete?.name}</span>?</p>
          <p className="text-sm text-yellow-400">I nodi del cluster diventeranno standalone.</p>
          <ModalFooter onCancel={() => setShowDeleteClusterModal(false)} onConfirm={handleDeleteCluster}
            confirmLabel="Elimina" confirmVariant="danger" />
        </div>
      </Modal>

      {/* Assign node to cluster modal */}
      <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title={`Assegna Nodo: ${assigningNode?.name}`}>
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Seleziona il cluster a cui assegnare questo nodo, oppure rimuovilo dal cluster corrente.</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {clusters.map(c => (
              <button key={c.id} onClick={() => handleAssign(c.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                  assigningNode?.cluster_id === c.id
                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                    : 'border-gray-700 hover:border-gray-500 text-gray-300 hover:bg-gray-800'
                }`}>
                <Layers size={16} />
                <div>
                  <p className="font-medium">{c.name}</p>
                  {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
                </div>
                {assigningNode?.cluster_id === c.id && <span className="ml-auto text-xs text-cyan-400">corrente</span>}
              </button>
            ))}
          </div>
          {assigningNode?.cluster_id && (
            <button onClick={() => handleAssign(null)}
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg border border-red-800 text-red-400 hover:bg-red-900/20 transition-colors text-sm">
              <Unlink size={14} /> Rimuovi dal cluster corrente
            </button>
          )}
          {clusters.length === 0 && (
            <p className="text-center text-gray-500 text-sm py-4">Nessun cluster creato. Crea prima un cluster.</p>
          )}
          <div className="flex justify-end pt-2 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowAssignModal(false)}>Chiudi</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}

function ModalFooter({ onCancel, onConfirm, confirmLabel, confirmVariant = 'primary' }) {
  return (
    <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
      <Button variant="ghost" onClick={onCancel}>Annulla</Button>
      <Button variant={confirmVariant} onClick={onConfirm} icon={<Save size={16} />}>{confirmLabel}</Button>
    </div>
  )
}

function Stat({ label, value, color }) {
  const colors = { cyan: 'text-cyan-400', purple: 'text-purple-400', green: 'text-green-400', red: 'text-red-400' }
  return (
    <div className="bg-gray-950 rounded-lg p-4 text-center">
      <p className={`text-2xl font-bold font-mono ${colors[color] || 'text-white'}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}
