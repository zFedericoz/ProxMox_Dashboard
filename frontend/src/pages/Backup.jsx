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
  const [historyVm, setHistoryVm] = useState('')
  const [backupHistory, setBackupHistory] = useState([])
  const [snapshotHistory, setSnapshotHistory] = useState([])
  const [backupHistoryLoading, setBackupHistoryLoading] = useState(false)
  const [snapshotHistoryLoading, setSnapshotHistoryLoading] = useState(false)
  const [backupHistoryWarning, setBackupHistoryWarning] = useState('')
  const [snapshotHistoryWarning, setSnapshotHistoryWarning] = useState('')
  const [selectedBackup, setSelectedBackup] = useState(null)
  const [showDeleteBackup, setShowDeleteBackup] = useState(false)
  const [showRestoreBackup, setShowRestoreBackup] = useState(false)
  const [restoreTargetStorage, setRestoreTargetStorage] = useState('')
  const [restoreStorageOptions, setRestoreStorageOptions] = useState([])
  const [restoreStorageLoading, setRestoreStorageLoading] = useState(false)
  const [restoreStorageWarning, setRestoreStorageWarning] = useState('')

  const getBackupVtype = (volid) => {
    return volid?.toLowerCase().includes('lxc') ? 'lxc' : 'qemu'
  }

  const loadRestoreStorageOptions = async (node, volid) => {
    setRestoreStorageLoading(true)
    setRestoreStorageWarning('')
    try {
      const vtype = getBackupVtype(volid)
      const res = await fetch(`/api/backup/restore-storages/${encodeURIComponent(node)}?vtype=${encodeURIComponent(vtype)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      if (!res.ok) {
        const errorText = await res.text()
        setRestoreStorageWarning(`Errore caricamento storage di restore: ${res.status} ${errorText}`)
        setRestoreStorageOptions([])
        setRestoreTargetStorage('')
        return
      }
      const data = await res.json()
      const options = data.storages || []
      setRestoreStorageOptions(options)
      setRestoreTargetStorage(options[0]?.storage || '')
      if (!options.length) {
        setRestoreStorageWarning(`Nessuno storage compatibile trovato per ${vtype} su nodo ${node}`)
      }
    } catch (e) {
      setRestoreStorageWarning(`Errore caricamento storage di restore: ${e.message || e}`)
      setRestoreStorageOptions([])
      setRestoreTargetStorage('')
    } finally {
      setRestoreStorageLoading(false)
    }
  }

  const openRestoreBackup = async (backup) => {
    setSelectedBackup(backup)
    setShowRestoreBackup(false)
    await loadRestoreStorageOptions(backup.node, backup.volid)
    setShowRestoreBackup(true)
  }

  const loadBackupHistory = async (node, vmid) => {
    setBackupHistoryLoading(true)
    setBackupHistoryWarning('')
    try {
      const res = await fetch(`/api/backup/history/${node}/${vmid}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      if (!res.ok) {
        const errorText = await res.text()
        setBackupHistoryWarning(`Errore nel caricamento dei backup: ${res.status} ${errorText}`)
        setBackupHistory([])
        return
      }
      const data = await res.json()
      const backups = (data.backups || []).filter(item => item.type !== 'snapshot')
      setBackupHistory(backups)
      if (data.warning) setBackupHistoryWarning(data.warning)
    } catch (e) {
      setBackupHistoryWarning(`Errore nel caricamento dei backup: ${e.message || e}`)
      setBackupHistory([])
    } finally {
      setBackupHistoryLoading(false)
    }
  }

  const loadSnapshotHistory = async (node, vmid) => {
    setSnapshotHistoryLoading(true)
    setSnapshotHistoryWarning('')
    const snapshots = []
    try {
      for (const vtype of ['qemu', 'lxc']) {
        try {
          const res = await fetch(`/api/snapshots/${node}/${vmid}?vtype=${vtype}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          })
          if (!res.ok) continue
          const data = await res.json()
          const items = (data.snapshots || []).map(snap => ({
            ...snap,
            type: 'snapshot',
            volid: snap.name || snap.snapname,
            ctime: snap.snaptime || snap.ctime || snap.time,
            vtype,
            node,
            storage: vtype
          }))
          snapshots.push(...items)
        } catch (nestedError) {
          // ignore individual vtype failures, continue with other type
        }
      }
      setSnapshotHistory(snapshots.sort((a, b) => (b.ctime || 0) - (a.ctime || 0)))
      if (snapshots.length === 0) {
        setSnapshotHistoryWarning('Nessuno snapshot trovato per questa VM')
      }
    } catch (e) {
      setSnapshotHistoryWarning('Errore nel caricamento degli snapshot')
      setSnapshotHistory([])
    } finally {
      setSnapshotHistoryLoading(false)
    }
  }

  const loadHistory = async (vmKey) => {
    if (!vmKey) {
      setBackupHistory([])
      setSnapshotHistory([])
      setBackupHistoryWarning('')
      setSnapshotHistoryWarning('')
      return
    }
    const [node, vmid] = vmKey.split('|')
    await Promise.all([
      loadBackupHistory(node, vmid),
      loadSnapshotHistory(node, vmid)
    ])
  }
  
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
      if (historyVm) loadHistory(historyVm)
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
      if (historyVm) loadHistory(historyVm)
    } else {
      toast.error(result.error || 'Errore ripristino')
    }
  }

  const handleDeleteBackup = async () => {
    if (!selectedBackup) return
    const { node, storage, volid } = selectedBackup
    const encodedVolid = encodeURIComponent(volid)
    const result = await execute(`/api/backup/${node}/${storage}/${encodedVolid}`, 'DELETE')

    if (result.success) {
      toast.success('Backup eliminato')
      if (historyVm) {
        const [node, vmid] = historyVm.split('|')
        loadBackupHistory(node, vmid)
      }
    } else {
      toast.error(result.error || 'Errore eliminazione backup')
    }
    setShowDeleteBackup(false)
    setSelectedBackup(null)
  }

  const handleRestoreBackup = async () => {
    if (!selectedBackup) return
    if (!restoreTargetStorage) {
      toast.error('Seleziona uno storage di destinazione compatibile')
      return
    }
    const { node, storage, volid } = selectedBackup
    const vmid = selectedBackup.vmid || historyVm.split('|')[1]
    const result = await execute(`/api/backup/${node}/${storage}/restore`, 'POST', {
      volid,
      vmid,
      target_storage: restoreTargetStorage
    })

    if (result.success) {
      toast.success('Ripristino avviato — controlla i task su Proxmox')
      if (historyVm) {
        const [node, vmid] = historyVm.split('|')
        loadBackupHistory(node, vmid)
      }
    } else {
      toast.error(result.error || 'Errore ripristino backup')
    }
    setShowRestoreBackup(false)
    setSelectedBackup(null)
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
        <div className="space-y-4">
          <Card>
            <CardHeader>Seleziona VM per vedere i backup e gli snapshot</CardHeader>
            <CardBody>
              <Select
                label="VM/CT"
                value={historyVm}
                onChange={(e) => { setHistoryVm(e.target.value); loadHistory(e.target.value) }}
              >
                <option value="">Seleziona...</option>
                {vms.map(vm => (
                  <option key={`${vm.node}|${vm.vmid}`} value={`${vm.node}|${vm.vmid}`}>
                    [{vm.vmid}] {vm.name || vm.vmid} — {vm.node}
                  </option>
                ))}
              </Select>
              {(backupHistoryWarning || snapshotHistoryWarning) && (
                <div className="mt-2 text-yellow-400 text-sm space-y-1">
                  {backupHistoryWarning && <div>⚠️ {backupHistoryWarning}</div>}
                  {snapshotHistoryWarning && <div>⚠️ {snapshotHistoryWarning}</div>}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card noPadding>
              <CardHeader>Cronologia Backup PBS ({backupHistory.length})</CardHeader>
              <CardBody className="p-0">
                {backupHistoryLoading ? (
                  <div className="p-6 text-center text-gray-400">Caricamento backup...</div>
                ) : backupHistory.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    {historyVm ? 'Nessun backup trovato per questa VM' : 'Seleziona una VM'}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-950 text-left">
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Storage</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">File</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Dimensione</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Data</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {backupHistory.map((b, i) => (
                        <tr key={i} className="hover:bg-gray-800/50">
                          <td className="px-4 py-3 text-cyan-400">{b.storage}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-300">{b.volid?.split('/').pop() || b.volid}</td>
                          <td className="px-4 py-3 text-gray-300">
                            {(b.csize || b.size)
                              ? `${((b.csize || b.size) / 1024 / 1024 / 1024).toFixed(2)} GB`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {b.ctime ? new Date(b.ctime * 1000).toLocaleString('it-IT') : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-9 h-9 p-0 flex items-center justify-center"
                                onClick={() => openRestoreBackup({ ...b, vmid: historyVm.split('|')[1] })}
                              >
                                <RotateCcw size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                className="w-9 h-9 p-0 flex items-center justify-center"
                                onClick={() => {
                                  setSelectedBackup({ ...b, vmid: historyVm.split('|')[1] })
                                  setShowDeleteBackup(true)
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>

            <Card noPadding>
              <CardHeader>Cronologia Snapshot ({snapshotHistory.length})</CardHeader>
              <CardBody className="p-0">
                {snapshotHistoryLoading ? (
                  <div className="p-6 text-center text-gray-400">Caricamento snapshot...</div>
                ) : snapshotHistory.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    {historyVm ? 'Nessuno snapshot trovato per questa VM' : 'Seleziona una VM'}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-950 text-left">
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Tipo</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Snapshot</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Dimensione</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Data</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {snapshotHistory.map((b, i) => (
                        <tr key={i} className="hover:bg-gray-800/50">
                          <td className="px-4 py-3 text-xs font-semibold uppercase text-gray-400">{b.vtype.toUpperCase()}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-300">{b.volid}</td>
                          <td className="px-4 py-3 text-gray-300">{b.ctime ? '—' : '—'}</td>
                          <td className="px-4 py-3 text-gray-400">
                            {b.ctime ? new Date(b.ctime * 1000).toLocaleString('it-IT') : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-9 h-9 p-0 flex items-center justify-center"
                                onClick={() => {
                                  setSnapToRestore({
                                    node: b.node,
                                    vmid: historyVm.split('|')[1],
                                    snapname: b.volid,
                                    vtype: b.vtype || 'qemu'
                                  })
                                  setRestoreStart(false)
                                  setShowRestoreModal(true)
                                }}
                              >
                                <RotateCcw size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                className="w-9 h-9 p-0 flex items-center justify-center"
                                onClick={() => {
                                  setSnapToDelete({
                                    node: b.node,
                                    vmid: historyVm.split('|')[1],
                                    snapname: b.volid
                                  })
                                  setShowDeleteConfirm(true)
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
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

      <ConfirmModal
        isOpen={showDeleteBackup}
        onClose={() => { setShowDeleteBackup(false); setSelectedBackup(null) }}
        onConfirm={handleDeleteBackup}
        title="Elimina Backup"
        message={`Sei sicuro di voler eliminare il backup "${selectedBackup?.volid?.split('/').pop()}"? Questa azione non puo essere annullata.`}
        loading={actionLoading}
      />

      <Modal
        isOpen={showRestoreBackup}
        onClose={() => setShowRestoreBackup(false)}
        title="Ripristina Backup"
      >
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Ripristino di: <span className="text-cyan-400 font-mono">{selectedBackup?.volid?.split('/').pop()}</span>
          </p>
          <Select
            label="Storage di destinazione"
            value={restoreTargetStorage}
            onChange={(e) => setRestoreTargetStorage(e.target.value)}
            disabled={restoreStorageLoading || !restoreStorageOptions.length}
          >
            {restoreStorageLoading ? (
              <option value="">Caricamento...</option>
            ) : restoreStorageOptions.length ? (
              restoreStorageOptions.map(s => (
                <option key={`${s.node}-${s.storage}`} value={s.storage}>{s.storage}</option>
              ))
            ) : (
              <option value="">Nessuno storage compatibile</option>
            )}
          </Select>
          {restoreStorageWarning && (
            <div className="text-yellow-400 text-sm">{restoreStorageWarning}</div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowRestoreBackup(false)}>Annulla</Button>
            <Button onClick={handleRestoreBackup}>Avvia ripristino</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
