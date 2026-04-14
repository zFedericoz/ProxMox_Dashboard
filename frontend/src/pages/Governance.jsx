import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { Badge, StatusBadge } from '../components/ui/Badge'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../utils/dateUtils'
import { User, Shield, FileText, Activity, Plus, Trash2 } from 'lucide-react'

export function Governance() {
  const toast = useToast()
  const { execute, loading: actionLoading } = useApiAction()
  
  const [activeTab, setActiveTab] = useState('users')
  const [newUser, setNewUser] = useState({ username: '', password: '', email: '', role: 'viewer' })

  const { data: usersData, refetch: refetchUsers } = useApi('/api/governance/users', { refetchInterval: 0 })
  const { data: auditData, refetch: refetchAudit } = useApi('/api/governance/audit', { refetchInterval: 30000 })
  const { data: accessData, refetch: refetchAccess } = useApi('/api/logs/access', { refetchInterval: 30000 })

  const users = usersData?.users || []
  const audit = auditData?.audit || []
  const access = accessData?.logs || []

  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.password) {
      toast.error('Username e password sono obbligatori')
      return
    }
    
    const result = await execute('/api/governance/users', 'POST', newUser)
    
    if (result.success) {
      toast.success('Utente creato con successo')
      setNewUser({ username: '', password: '', email: '', role: 'viewer' })
      refetchUsers()
    } else {
      toast.error(result.error || 'Errore creazione utente')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'users' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <User size={16} />
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
        <button
          onClick={() => setActiveTab('access')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'access' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Activity size={16} />
          Access Log
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>Crea Nuovo Utente</CardHeader>
            <CardBody className="space-y-4">
              <Input
                label="Username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="username"
              />
              <Input
                label="Password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="password"
              />
              <Input
                label="Email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="user@example.com"
              />
              <Select
                label="Ruolo"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              >
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </Select>
              <Button onClick={handleCreateUser} loading={actionLoading} icon={<Plus size={16} />}>
                Crea Utente
              </Button>
            </CardBody>
          </Card>

          <div className="lg:col-span-2">
            <Card noPadding>
              <CardHeader>Utenti ({users.length})</CardHeader>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-950 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">ID</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Username</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Email</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ruolo</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Attivo</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Creato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {users.map((user, i) => (
                      <tr key={i} className="hover:bg-gray-800/50">
                        <td className="px-4 py-3 font-mono text-gray-500">{user.id}</td>
                        <td className="px-4 py-3 text-cyan-400 font-medium">{user.username}</td>
                        <td className="px-4 py-3 text-gray-400">{user.email || '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={
                            user.role === 'admin' ? 'danger' :
                            user.role === 'operator' ? 'warning' : 'info'
                          }>
                            {user.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {user.is_active ? (
                            <span className="text-green-400 text-sm">Attivo</span>
                          ) : (
                            <span className="text-red-400 text-sm">Disattivo</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{user.created_at || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <Card noPadding>
          <CardHeader>Audit Log ({audit.length} entries)</CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azione</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Risorsa</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Severita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {audit.map((entry, i) => (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {entry.timestamp ? formatDate(entry.timestamp) : '-'}
                    </td>
                    <td className="px-4 py-3 text-cyan-400">{entry.user}</td>
                    <td className="px-4 py-3 text-white">{entry.action}</td>
                    <td className="px-4 py-3 text-gray-400">{entry.resource || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} /></td>
                    <td className="px-4 py-3">
                      <Badge variant={
                        entry.severity === 'critical' ? 'danger' :
                        entry.severity === 'warning' ? 'warning' : 'info'
                      }>
                        {entry.severity}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {activeTab === 'access' && (
        <Card noPadding>
          <CardHeader>Access Log ({access.length} entries)</CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Utente</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Metodo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Endpoint</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">IP</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {access.map((entry, i) => (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {entry.timestamp ? formatDate(entry.timestamp) : '-'}
                    </td>
                    <td className="px-4 py-3 text-cyan-400">{entry.username || '-'}</td>
                    <td className="px-4 py-3 font-mono text-gray-300">{entry.method || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{entry.endpoint || '-'}</td>
                    <td className="px-4 py-3 font-mono text-gray-500">{entry.ip_address || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono ${(entry.status_code || 200) >= 400 ? 'text-red-400' : 'text-green-400'}`}>
                        {entry.status_code || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
