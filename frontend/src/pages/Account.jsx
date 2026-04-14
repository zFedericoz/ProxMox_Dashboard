import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { formatDate } from '../utils/dateUtils'
import { User, Lock, Activity, Eye, EyeOff } from 'lucide-react'

export function Account() {
  const { user } = useAuth()
  const toast = useToast()
  const { execute } = useApiAction()
  const { data: auditData } = useApi('/api/governance/audit', { params: { limit: 50 }, refetchInterval: 30000 })

  const [profile, setProfile] = useState({
    username: user?.username || '',
    email: '',
  })

  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: '',
  })
  const [showPasswords, setShowPasswords] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const auditLogs = auditData?.audit || []
  const myLogs = auditLogs.filter(log => log.user === user?.username)

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const result = await execute('/api/account/profile', 'PUT', profile)
      if (result.success) {
        toast.success('Profilo aggiornato')
      } else {
        toast.error(result.error || 'Errore salvataggio')
      }
    } catch (err) {
      toast.error('Errore di connessione')
    }
    setSavingProfile(false)
  }

  const handleChangePassword = async () => {
    if (!passwords.current) {
      toast.error('Inserisci la password attuale')
      return
    }
    if (passwords.new.length < 6) {
      toast.error('La nuova password deve essere di almeno 6 caratteri')
      return
    }
    if (passwords.new !== passwords.confirm) {
      toast.error('Le password non coincidono')
      return
    }

    setSavingPassword(true)
    try {
      const result = await execute('/api/account/password', 'POST', {
        current_password: passwords.current,
        new_password: passwords.new,
      })
      if (result.success) {
        toast.success('Password cambiata con successo')
        setPasswords({ current: '', new: '', confirm: '' })
      } else {
        toast.error(result.error || 'Errore cambio password')
      }
    } catch (err) {
      toast.error('Errore di connessione')
    }
    setSavingPassword(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Il Mio Account</h1>
          <p className="text-sm text-gray-400 mt-1">Gestisci le informazioni del tuo profilo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <span className="flex items-center gap-2">
              <User size={18} />
              Informazioni Profilo
            </span>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={profile.username}
                onChange={(e) => setProfile({ ...profile, username: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
                disabled
              />
              <p className="text-xs text-gray-500 mt-1">L'username non può essere modificato</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                placeholder="email@esempio.com"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Ruolo</label>
              <input
                type="text"
                value={user?.role || 'viewer'}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 focus:outline-none focus:border-cyan-500"
                disabled
              />
            </div>
            <Button onClick={handleSaveProfile} loading={savingProfile}>
              Salva Profilo
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <span className="flex items-center gap-2">
              <Lock size={18} />
              Cambio Password
            </span>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-400 mb-1">Password Attuale</label>
              <input
                type={showPasswords ? 'text' : 'password'}
                value={passwords.current}
                onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                className="w-full px-3 py-2 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => setShowPasswords(!showPasswords)}
                className="absolute right-3 top-8 text-gray-500 hover:text-gray-300"
              >
                {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Input
              label="Nuova Password"
              type={showPasswords ? 'text' : 'password'}
              value={passwords.new}
              onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
              placeholder="Minimo 6 caratteri"
            />
            <Input
              label="Conferma Nuova Password"
              type={showPasswords ? 'text' : 'password'}
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              placeholder="Ripeti la password"
            />
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-cyan-500"
              />
              Mostra password
            </label>
            <Button onClick={handleChangePassword} loading={savingPassword}>
              Cambia Password
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card noPadding>
        <CardHeader>
          <span className="flex items-center gap-2">
            <Activity size={18} />
            Attivita Recente ({myLogs.length})
          </span>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Timestamp</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Azione</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Risorsa</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {myLogs.slice(0, 20).map((log, i) => (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {log.timestamp ? formatDate(log.timestamp) : '-'}
                  </td>
                  <td className="px-4 py-3 text-white">{log.action}</td>
                  <td className="px-4 py-3 text-gray-400">{log.resource || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      log.status === 'success' ? 'bg-green-900/50 text-green-400' :
                      log.status === 'failed' ? 'bg-red-900/50 text-red-400' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {myLogs.length === 0 && (
            <div className="p-8 text-center text-gray-500">Nessuna attivita registrata</div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
