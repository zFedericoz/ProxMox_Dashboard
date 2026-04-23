import { useEffect, useState } from 'react'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { Modal } from '../components/ui/Modal'
import { Plus, Edit2, Trash2, Server, Wifi, WifiOff, Save, X, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'

export function Settings() {
  const toast = useToast()
  const { execute: apiExecute } = useApiAction()
  const { data: nodesData, refetch } = useApi('/api/nodes')
  const { data: clusterData } = useApi('/api/cluster/nodes')

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingNode, setEditingNode] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [nodeToDelete, setNodeToDelete] = useState(null)

  const [nodes, setNodes] = useState([])
  const clusterNodes = clusterData?.nodes || []

  useEffect(() => {
    if (nodesData?.nodes) setNodes(nodesData.nodes)
  }, [nodesData])

  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 8006,
    timeout: 8,
    zone: 'Default',
  })

  const openAddModal = () => {
    setFormData({ name: '', host: '', port: 8006, timeout: 8, zone: 'Default' })
    setEditingNode(null)
    setShowAddModal(true)
  }

  const openEditModal = (node) => {
    setFormData({
      name: node.name,
      host: node.host,
      port: node.port || 8006,
      timeout: node.timeout || 8,
      zone: node.zone || 'Default',
    })
    setEditingNode(node)
    setShowAddModal(true)
  }

  const openDeleteModal = (node) => {
    setNodeToDelete(node)
    setShowDeleteModal(true)
  }

  const handleSave = async () => {
    if (!formData.name || !formData.host) {
      toast.error('Nome e Host sono obbligatori')
      return
    }

    const method = editingNode ? 'PUT' : 'POST'
    const url = editingNode ? `/api/nodes/${editingNode.name}` : '/api/nodes'

    const result = await apiExecute(url, method, formData)
    if (result.success) {
      toast.success(editingNode ? 'Nodo aggiornato' : 'Nodo creato')
      setShowAddModal(false)
      refetch()
    } else {
      toast.error(result.error || 'Errore salvataggio')
    }
  }

  const handleDelete = async () => {
    if (!nodeToDelete) return
    const result = await apiExecute(`/api/nodes/${nodeToDelete.name}`, 'DELETE')
    if (result.success) {
      toast.success('Nodo eliminato')
      setShowDeleteModal(false)
      setNodeToDelete(null)
      refetch()
    } else {
      toast.error(result.error || 'Errore eliminazione')
    }
  }

  const handleToggle = async (node) => {
    const nextEnabled = !node.enabled

    // Optimistic UI update: immediately reflect the new state in the toggle.
    setNodes(prev => prev.map(n => (n.name === node.name ? { ...n, enabled: nextEnabled } : n)))

    const result = await apiExecute(`/api/nodes/${node.name}`, 'PUT', { enabled: nextEnabled })
    if (result.success) {
      toast.success(`Nodo ${nextEnabled ? 'abilitato' : 'disabilitato'}`)
      refetch()
    } else {
      // Revert on failure
      setNodes(prev => prev.map(n => (n.name === node.name ? { ...n, enabled: !nextEnabled } : n)))
      toast.error(result.error || 'Errore aggiornamento nodo')
    }
  }

  const getNodeStatus = (nodeName) => {
    const cn = clusterNodes.find(n => n.name === nodeName)
    return cn?.status || 'offline'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Impostazioni</h1>
          <p className="text-sm text-gray-400 mt-1">Gestisci i nodi Proxmox e la configurazione del cluster</p>
        </div>
        <Button onClick={openAddModal} icon={<Plus size={16} />}>
          Aggiungi Nodo
        </Button>
      </div>

      <Card noPadding>
        <CardHeader>Node Proxmox Configurati</CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nome</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Host</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Porta</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timeout</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Zona</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Abilitato</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {nodes.map((node) => {
                const status = getNodeStatus(node.name)
                return (
                  <tr key={node.name} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      {status === 'online' ? (
                        <span className="flex items-center gap-1 text-green-400">
                          <Wifi size={14} />
                        </span>
                      ) : status === 'offline' ? (
                        <span className="flex items-center gap-1 text-red-400">
                          <WifiOff size={14} />
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-400">
                          <RefreshCw size={14} className="animate-spin" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-cyan-400 font-medium">{node.name}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{node.host}</td>
                    <td className="px-4 py-3 font-mono text-gray-400">{node.port || 8006}</td>
                    <td className="px-4 py-3 font-mono text-gray-400">{node.timeout || 8}s</td>
                    <td className="px-4 py-3 text-purple-400">{node.zone || 'Default'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(node)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          node.enabled ? 'bg-cyan-500' : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            node.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(node)}
                          className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded transition-colors"
                          title="Modifica"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => openDeleteModal(node)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                          title="Elimina"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {nodes.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <Server size={48} className="mx-auto mb-4 opacity-50" />
              <p>Nessun nodo configurato</p>
              <p className="text-sm mt-2">Clicca su "Aggiungi Nodo" per iniziare</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Informazioni Configurazione</CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase">Credenziali Globali</h3>
              <div className="bg-gray-950 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Utente:</span>
                  <span className="text-cyan-400 font-mono">root@pam</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Verifica SSL:</span>
                  <span className={false ? 'text-green-400' : 'text-yellow-400'}>Disabilitata</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Le credenziali sono configurate nel file .env
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase">API Proxmox</h3>
              <div className="bg-gray-950 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Nodi configurati:</span>
                  <span className="text-white font-mono">{nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Nodi online:</span>
                  <span className="text-green-400 font-mono">{clusterNodes.filter(n => n.status === 'online').length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Nodi offline:</span>
                  <span className="text-red-400 font-mono">{clusterNodes.filter(n => n.status === 'offline').length}</span>
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={editingNode ? 'Modifica Nodo' : 'Aggiungi Nodo'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Nome Nodo *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="es. G5ProxMox1"
              disabled={!!editingNode}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Host/IP *</label>
            <input
              type="text"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              placeholder="es. 172.16.255.171"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Porta API</label>
              <input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 8006 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Timeout (sec)</label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 8 })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Zona</label>
            <input
              type="text"
              value={formData.zone}
              onChange={(e) => setFormData({ ...formData, zone: e.target.value })}
              placeholder="es. Produzione, Test, Sviluppo"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowAddModal(false)}>
              Annulla
            </Button>
            <Button onClick={handleSave} icon={<Save size={16} />}>
              {editingNode ? 'Salva Modifiche' : 'Aggiungi Nodo'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Conferma Eliminazione"
      >
        <div className="space-y-4">
          <p className="text-gray-300">
            Sei sicuro di voler eliminare il nodo <span className="text-cyan-400 font-mono">{nodeToDelete?.name}</span>?
          </p>
          <p className="text-sm text-yellow-400">
            Questa azione potrebbe causare la perdita della visibilita del nodo nella dashboard.
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>
              Annulla
            </Button>
            <Button variant="danger" onClick={handleDelete} icon={<Trash2 size={16} />}>
              Elimina
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
