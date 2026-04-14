import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Select, Input } from '../components/ui/Input'
import { StatusBadge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { ConfirmModal, Modal } from '../components/ui/Modal'
import { HardDrive, Camera, Play, Trash2, Plus, RotateCcw } from 'lucide-react'

export function Backup() {
  const toast = useToast()
  const { execute, loading: actionLoading } = useApiAction()
  
  const [activeTab, setActiveTab] = useState('snapshots')
  const [selectedVm, setSelectedVm] = useState('')
  const [snapName, setSnapName] = useState('')
  const [snapDesc, setSnapDesc] = useState('')
  const [backupStorage, setBackupStorage] = useState('')
  const [backupMode, setBackupMode] = useState('snapshot')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [snapToDelete, setSnapToDelete] = useState(null)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [snapToRestore, setSnapToRestore] = useState(null)
  const [restoreStart, setRestoreStart] = useState(false)
  const [restoring, setRestoring] = useState(false)
  
  const { data: allData, refetch } = useApi('/api/cluster/all', { refetchInterval: 30000 })
  const { data: storageData, refetch: refetchStorage } = useApi('/api/backup/storages')
  const { data: snapshotsData, refetch: refetchSnapshots } = useApi('/api/snapshots/all')

  const vms = [...(allData?.vms || []), ...(allData?.containers || [])]
  const storages = storageData?.storages || []
  const snapshots = snapshotsData?.snapshots || []

  const handleCreateSnapshot = async () => {
    if (!selectedVm) {
      toast.error('Seleziona una VM')
      return
    }
    if (!snapName) {
      toast.error('Inserisci un nome per lo snapshot')
      return
    }
    
    const [node, vmid] = selectedVm.split('|')
    const result = await execute(`/api/snapshots/${node}/${vmid}`, 'POST', {
      snapname: snapName,
      description: snapDesc || `Snapshot manuale: ${snapName}`
    })
    
    if (result.success) {
      toast.success('Snapshot creato con successo')
      setSnapName('')
      setSnapDesc('')
      refetchSnapshots()
    } else {
      toast.error(result.error || 'Errore creazione snapshot')
    }
  }

  const handleTriggerBackup = async () => {
    if (!selectedVm) {
      toast.error('Seleziona una VM')
      return
    }
    if (!backupStorage) {
      toast.error('Seleziona uno storage di backup')
      return
    }
    
    const [node, vmid] = selectedVm.split('|')
    const result = await execute(`/api/backup/trigger/${node}/${vmid}`, 'POST', {
      storage: backupStorage,
      mode: backupMode
    })
    
    if (result.success) {
      toast.success('Backup avviato')
    } else {
      toast.error(result.error || 'Errore avvio backup')
    }
  }

  const handleDeleteSnapshot = async () => {
    if (!snapToDelete) return
    
    const { node, vmid, snapname } = snapToDelete
    const result = await execute(`/api/snapshots/${node}/${vmid}/${encodeURIComponent(snapname)}`, 'DELETE')
    
    if (result.success) {
      toast.success('Snapshot eliminato')
      refetchSnapshots()
    } else {
      toast.error(result.error || 'Errore eliminazione')
    }
    setShowDeleteConfirm(false)
    setSnapToDelete(null)
  }

  const handleRestoreSnapshot = async () => {
    if (!snapToRestore) return
    
    setRestoring(true)
    const { node, vmid, snapname, vtype } = snapToRestore
    const result = await execute(`/api/snapshots/${node}/${vmid}/${encodeURIComponent(snapname)}/restore`, 'POST', {
      start: restoreStart,
      vtype: vtype || 'qemu'
    })
    setRestoring(false)
    
    if (result.success) {
      toast.success('Snapshot ripristinato con successo')
      setShowRestoreModal(false)
      setSnapToRestore(null)
    } else {
      toast.error(result.error || 'Errore ripristino')
    }
  }

  const openRestoreModal = (snap) => {
    setSnapToRestore(snap)
    setRestoreStart(false)
    setShowRestoreModal(true)
  }

  const generateSnapName = () => {
    const now = new Date()
    const name = `snap-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`
    setSnapName(name)
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('snapshots')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'snapshots' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Camera size={16} />
          Snapshot
        </button>
        <button
          onClick={() => setActiveTab('backup')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'backup' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Play size={16} />
          Backup PBS
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'history' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <HardDrive size={16} />
          Cronologia
        </button>
      </div>

      {activeTab === 'snapshots' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>Crea Snapshot</CardHeader>
            <CardBody className="space-y-4">
              <Select
                label="Seleziona VM/CT"
                value={selectedVm}
                onChange={(e) => setSelectedVm(e.target.value)}
              >
                <option value="">Seleziona...</option>
                {vms.map(vm => (
                  <option key={`${vm.node}|${vm.vmid}`} value={`${vm.node}|${vm.vmid}`}>
                    {vm.name || vm.vmid} ({vm.node})
                  </option>
                ))}
              </Select>
              
              <div>
                <div className="flex items-end gap-2">
                  <Input
                    label="Nome Snapshot"
                    value={snapName}
                    onChange={(e) => setSnapName(e.target.value)}
                    placeholder="snap-YYYYMMDD-HHMM"
                  />
                  <Button variant="ghost" onClick={generateSnapName} className="mb-1">
                    Auto
                  </Button>
                </div>
              </div>
              
              <Input
                label="Descrizione (opzionale)"
                value={snapDesc}
                onChange={(e) => setSnapDesc(e.target.value)}
                placeholder="Descrizione snapshot..."
              />
              
              <Button onClick={handleCreateSnapshot} loading={actionLoading} icon={<Camera size={16} />}>
                Crea Snapshot
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <span>Storage Disponibili</span>
              <span className="text-xs text-gray-500">{storages.length} storage</span>
            </CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Storage</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nodo</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {storages.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-cyan-400 font-mono">{s.storage || s.id}</td>
                      <td className="px-4 py-3 text-gray-400">{s.node}</td>
                      <td className="px-4 py-3 text-gray-500">{s.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>
      )}

      {activeTab === 'backup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>Backup Manuale PBS</CardHeader>
            <CardBody className="space-y-4">
              <Select
                label="Seleziona VM/CT"
                value={selectedVm}
                onChange={(e) => setSelectedVm(e.target.value)}
              >
                <option value="">Seleziona...</option>
                {vms.map(vm => (
                  <option key={`${vm.node}|${vm.vmid}`} value={`${vm.node}|${vm.vmid}`}>
                    {vm.name || vm.vmid} ({vm.node})
                  </option>
                ))}
              </Select>
              
              <Select
                label="Storage PBS"
                value={backupStorage}
                onChange={(e) => setBackupStorage(e.target.value)}
              >
                <option value="">Seleziona...</option>
                {storages.map(s => (
                  <option key={s.storage || s.id} value={s.storage || s.id}>
                    {s.storage || s.id} ({s.node})
                  </option>
                ))}
              </Select>
              
              <Select
                label="Modalita Backup"
                value={backupMode}
                onChange={(e) => setBackupMode(e.target.value)}
              >
                <option value="snapshot">Snapshot (veloce, VM attiva)</option>
                <option value="stop">Stop (VM spenta, backup completo)</option>
                <option value="suspend">Suspend (VM sospesa)</option>
              </Select>
              
              <Button onClick={handleTriggerBackup} loading={actionLoading} icon={<Play size={16} />}>
                Avvia Backup
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>Info</CardHeader>
            <CardBody>
              <div className="space-y-3 text-sm text-gray-400">
                <p><strong className="text-white">Modalita Snapshot:</strong> La VM continua a funzionare durante il backup. Piu veloce.</p>
                <p><strong className="text-white">Modalita Stop:</strong> La VM viene spenta prima del backup. Backup completo garantito.</p>
                <p><strong className="text-white">Modalita Suspend:</strong> La VM viene sospesa. Bilanciato tra velocita e completezza.</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {activeTab === 'history' && (
        <Card noPadding>
          <CardHeader>
            <span>Tutti gli Snapshot ({snapshots.length})</span>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nodo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">VM</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nome</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Tipo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Data</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {snapshots.map((snap, i) => (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-mono text-cyan-400">{snap.node}</td>
                    <td className="px-4 py-3">{snap.vm_name || snap.vmid}</td>
                    <td className="px-4 py-3 font-mono">{snap.name}</td>
                    <td className="px-4 py-3">{snap.vtype === 'qemu' ? 'VM' : 'LXC'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {snap.snaptime ? new Date(snap.snaptime * 1000).toLocaleString('it-IT') : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openRestoreModal(snap)}
                          className="p-1.5 text-green-400 hover:bg-green-900/50 rounded"
                          title="Ripristina snapshot"
                        >
                          <RotateCcw size={14} />
                        </button>
                        {!snap.protected && (
                          <button
                            onClick={() => {
                              setSnapToDelete({ node: snap.node, vmid: snap.vmid, snapname: snap.name })
                              setShowDeleteConfirm(true)
                            }}
                            className="p-1.5 text-red-400 hover:bg-red-900/50 rounded"
                            title="Elimina snapshot"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {snapshots.length === 0 && (
              <div className="p-8 text-center text-gray-500">Nessuno snapshot presente</div>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        title="Ripristina Snapshot"
      >
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex justify-between mb-2">
              <span className="text-gray-400">Nodo:</span>
              <span className="text-cyan-400 font-mono">{snapToRestore?.node}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-gray-400">VM:</span>
              <span className="text-white">{snapToRestore?.vm_name || snapToRestore?.vmid}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Snapshot:</span>
              <span className="text-purple-400 font-mono">{snapToRestore?.name}</span>
            </div>
          </div>

          <p className="text-sm text-gray-400">
            Il ripristino riporta la VM allo stato in cui era quando e stato creato lo snapshot. 
            Lo stato attuale andra perso se non sono presenti altri snapshot.
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={restoreStart}
              onChange={(e) => setRestoreStart(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-cyan-500"
            />
            Avvia VM dopo il ripristino
          </label>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowRestoreModal(false)}>
              Annulla
            </Button>
            <Button onClick={handleRestoreSnapshot} loading={restoring} icon={<RotateCcw size={16} />}>
              Ripristina Snapshot
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => { setShowDeleteConfirm(false); setSnapToDelete(null); }}
        onConfirm={handleDeleteSnapshot}
        title="Elimina Snapshot"
        message={`Sei sicuro di voler eliminare lo snapshot "${snapToDelete?.snapname}"? Questa azione non puo essere annullata.`}
        loading={actionLoading}
      />
    </div>
  )
}
