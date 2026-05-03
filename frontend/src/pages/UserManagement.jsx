import { useState } from 'react'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { Modal } from '../components/ui/Modal'
import { ConfirmModal } from '../components/ui/Modal'
import { formatDate } from '../utils/dateUtils'
import { 
  User, Shield, Key, LogOut, Trash2, Edit2, Plus, Users,
  Activity, CheckCircle2, XCircle
} from 'lucide-react'

export function UserManagement() {
  const toast = useToast()
  const { execute: apiExecute } = useApiAction()
  const { data: usersData, refetch } = useApi('/api/admin/users')
  const { data: auditData } = useApi('/api/governance/audit', { refetchInterval: 30000 })

  const [activeTab, setActiveTab] = useState('users')
  const [selectedUser, setSelectedUser] = useState(null)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const [editForm, setEditForm] = useState({ email: '', role: '', is_active: true })
  const [resetPassword, setResetPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [createForm, setCreateForm] = useState({ username: '', password: '', email: '', role: 'viewer' })

  const [loading, setLoading] = useState(false)
  const { data: activityData } = useApi(
    selectedUser ? `/api/admin/users/${selectedUser?.username}/activity` : null,
    { immediate: false }
  )

  const users = usersData?.users || []
  const auditLogs = auditData?.audit || []

  const openActivity = async (user) => {
    setSelectedUser(user)
    const result = await apiExecute(`/api/admin/users/${user.username}/activity`)
    if (result.success) {
      setShowActivityModal(true)
    }
  }

  const openEdit = (user) => {
    setSelectedUser(user)
    setEditForm({ email: user.email || '', role: user.role, is_active: !!user.is_active })
    setShowEditModal(true)
  }

  const openReset = (user) => {
    setSelectedUser(user)
    setResetPassword('')
    setNewPassword('')
    setShowResetModal(true)
  }

  const openDelete = (user) => {
    setSelectedUser(user)
    setShowDeleteModal(true)
  }

  const handleToggleActive = async (user) => {
    const result = await apiExecute(`/api/admin/users/${user.username}/toggle-active`, 'POST')
    if (result.success) {
      toast.success(`Utente ${result.data.is_active ? 'abilitato' : 'disabilitato'}`)
      refetch()
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const handleForceLogout = async (user) => {
    const result = await apiExecute(`/api/admin/users/${user.username}/force-logout`, 'POST')
    if (result.success) {
      toast.success(`Sessione terminata per ${user.username}`)
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const handleSaveEdit = async () => {
    if (!selectedUser) return
    setLoading(true)
    const result = await apiExecute(`/api/admin/users/${selectedUser.username}`, 'PUT', editForm)
    setLoading(false)
    if (result.success) {
      toast.success('Utente aggiornato')
      setShowEditModal(false)
      refetch()
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const handleResetPassword = async () => {
    if (!selectedUser) return
    setLoading(true)
    const password = newPassword || undefined
    const result = await apiExecute(`/api/admin/users/${selectedUser.username}/reset-password`, 'POST', { new_password: password })
    setLoading(false)
    if (result.success) {
      toast.success('Password resettata')
      setResetPassword(result.data?.new_password || '')
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const handleDelete = async () => {
    if (!selectedUser) return
    setLoading(true)
    const result = await apiExecute(`/api/admin/users/${selectedUser.username}`, 'DELETE')
    setLoading(false)
    if (result.success) {
      toast.success('Utente eliminato')
      setShowDeleteModal(false)
      setSelectedUser(null)
      refetch()
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  const handleCreate = async () => {
    if (!createForm.username || !createForm.password) {
      toast.error('Username e password sono obbligatori')
      return
    }
    setLoading(true)
    const result = await apiExecute('/api/admin/users', 'POST', createForm)
    setLoading(false)
    if (result.success) {
      toast.success('Utente creato')
      setShowCreateModal(false)
      setCreateForm({ username: '', password: '', email: '', role: 'viewer' })
      refetch()
    } else {
      toast.error(result.error || 'Errore')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Gestione Utenti</h1>
          <p className="text-sm text-gray-400 mt-1">Amministra utenti, audit log e accessi</p>
        </div>
        {activeTab === 'users' && (
          <Button onClick={() => setShowCreateModal(true)} icon={<Plus size={16} />}>
            Nuovo Utente
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'users' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Users size={16} />
          Utenti
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'audit' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Shield size={16} />
          Audit Log
        </button>
      </div>

      {activeTab === 'users' && (
        <Card noPadding>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ruolo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Attivita</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ultimo Accesso</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Creato</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {users.map((user) => (
                  <tr key={user.username} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          user.role === 'admin' ? 'bg-purple-900 text-purple-300' :
                          user.role === 'operator' ? 'bg-cyan-900 text-cyan-300' :
                          'bg-gray-700 text-gray-300'
                        }`}>
                          {user.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">{user.username}</p>
                          <p className="text-xs text-gray-500">{user.email || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'operator' ? 'warning' : 'info'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {user.is_active ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle2 size={14} /> Attivo
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-xs">
                          <XCircle size={14} /> Disattivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{user.activity_count || 0} azioni</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {user.last_login ? formatDate(user.last_login) : 'Mai'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDate(user.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openActivity(user)} className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-gray-700 rounded transition-colors" title="Vedi attivita">
                          <Activity size={14} />
                        </button>
                        <button onClick={() => openEdit(user)} className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors" title="Modifica">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => openReset(user)} className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded transition-colors" title="Reset password">
                          <Key size={14} />
                        </button>
                        <button onClick={() => handleForceLogout(user)} className="p-1.5 text-gray-400 hover:text-orange-400 hover:bg-gray-700 rounded transition-colors" title="Forza logout">
                          <LogOut size={14} />
                        </button>
                        <button onClick={() => handleToggleActive(user)} disabled={user.username === 'admin'} className="p-1.5 text-gray-400 hover:text-purple-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-30" title={user.is_active ? 'Disabilita' : 'Abilita'}>
                          {user.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                        </button>
                        <button onClick={() => openDelete(user)} disabled={user.username === 'admin'} className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-30" title="Elimina">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                <User size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nessun utente trovato</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === 'audit' && (
        <Card noPadding>
          <CardHeader>Audit Log ({auditLogs.length} entries)</CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azione</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Risorsa</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Severita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {auditLogs.map((log, i) => (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {log.timestamp ? formatDate(log.timestamp) : '-'}
                    </td>
                    <td className="px-4 py-3 text-cyan-400">{log.user}</td>
                    <td className="px-4 py-3 text-white">{log.action}</td>
                    <td className="px-4 py-3 text-gray-400">{log.resource || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={log.severity === 'critical' ? 'danger' : log.severity === 'warning' ? 'warning' : 'info'}>
                        {log.severity}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLogs.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                <Shield size={48} className="mx-auto mb-4 opacity-50" />
                <p>Nessun log di audit</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Modal isOpen={showActivityModal} onClose={() => setShowActivityModal(false)} title={`Attivita: ${selectedUser?.username}`}>
        <CardBody className="max-h-96 overflow-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-3 py-2 text-gray-400">Timestamp</th>
                <th className="px-3 py-2 text-gray-400">Azione</th>
                <th className="px-3 py-2 text-gray-400">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {(activityData?.activity || []).map((log, i) => (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="px-3 py-2 text-gray-500">{formatDate(log.timestamp)}</td>
                  <td className="px-3 py-2 text-white">{log.action}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded ${
                      log.severity === 'critical' ? 'bg-red-900/50 text-red-400' :
                      log.severity === 'warning' ? 'bg-yellow-900/50 text-yellow-400' :
                      'bg-green-900/50 text-green-400'
                    }`}>{log.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!activityData?.activity || activityData.activity.length === 0) && (
            <div className="p-4 text-center text-gray-500">Nessuna attivita</div>
          )}
        </CardBody>
      </Modal>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Modifica: ${selectedUser?.username}`}>
        <div className="space-y-4">
          <Input label="Email" value={editForm.email} onChange={(e) => setEditForm({...editForm, email: e.target.value})} />
          <Select label="Ruolo" value={editForm.role} onChange={(e) => setEditForm({...editForm, role: e.target.value})}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({...editForm, is_active: e.target.checked})} className="rounded border-gray-600 bg-gray-800 text-cyan-500" />
            Utente attivo
          </label>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowEditModal(false)}>Annulla</Button>
            <Button onClick={handleSaveEdit} loading={loading}>Salva</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showResetModal} onClose={() => setShowResetModal(false)} title={`Reset Password: ${selectedUser?.username}`}>
        <div className="space-y-4">
          {resetPassword && (
            <div className="bg-green-900/30 border border-green-800 rounded-lg p-4">
              <p className="text-sm text-green-400 mb-2">Nuova password temporanea:</p>
              <p className="text-xl font-mono font-bold text-white">{resetPassword}</p>
              <p className="text-xs text-gray-500 mt-2">Comunicala all'utente in modo sicuro.</p>
            </div>
          )}
          <Input label="Nuova password (opzionale)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Lascia vuoto per generare automaticamente" />
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowResetModal(false)}>Chiudi</Button>
            {!resetPassword && <Button onClick={handleResetPassword} loading={loading} icon={<Key size={16} />}>Genera Password</Button>}
          </div>
        </div>
      </Modal>

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Crea Nuovo Utente">
        <div className="space-y-4">
          <Input label="Username *" value={createForm.username} onChange={(e) => setCreateForm({...createForm, username: e.target.value})} />
          <Input label="Password *" type="password" value={createForm.password} onChange={(e) => setCreateForm({...createForm, password: e.target.value})} />
          <Input label="Email" value={createForm.email} onChange={(e) => setCreateForm({...createForm, email: e.target.value})} />
          <Select label="Ruolo" value={createForm.role} onChange={(e) => setCreateForm({...createForm, role: e.target.value})}>
            <option value="viewer">Viewer - Solo lettura</option>
            <option value="operator">Operator - Operazioni base</option>
            <option value="admin">Admin - Accesso completo</option>
          </Select>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Annulla</Button>
            <Button onClick={handleCreate} loading={loading} icon={<Plus size={16} />}>Crea Utente</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Elimina Utente"
        message={`Sei sicuro di voler eliminare l'utente "${selectedUser?.username}"? Questa azione non puo essere annullata.`}
        loading={loading}
      />
    </div>
  )
}
