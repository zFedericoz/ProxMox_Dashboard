import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Bell, AlertTriangle, Info, CheckCircle } from 'lucide-react'

export function Alerts() {
  const { data: alertsData } = useApi('/api/alerts', { refetchInterval: 15000 })
  
  const liveAlerts = alertsData?.live_alerts || []
  const dbAlerts = alertsData?.alerts || []

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertTriangle size={16} className="text-red-400" />
      case 'warning': return <AlertTriangle size={16} className="text-yellow-400" />
      default: return <Info size={16} className="text-blue-400" />
    }
  }

  const getSeverityBg = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-900/20 border-red-800'
      case 'warning': return 'bg-yellow-900/20 border-yellow-800'
      default: return 'bg-blue-900/20 border-blue-800'
    }
  }

  const allAlerts = [...liveAlerts, ...dbAlerts]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Bell size={14} />
            <span>Totale Alert</span>
          </div>
          <p className="text-2xl font-bold font-mono text-white">{allAlerts.length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-500 text-xs mb-2">
            <AlertTriangle size={14} />
            <span>Critici</span>
          </div>
          <p className="text-2xl font-bold font-mono text-red-400">
            {allAlerts.filter(a => a.severity === 'critical').length}
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-yellow-500 text-xs mb-2">
            <AlertTriangle size={14} />
            <span>Warning</span>
          </div>
          <p className="text-2xl font-bold font-mono text-yellow-400">
            {allAlerts.filter(a => a.severity === 'warning').length}
          </p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-green-500 text-xs mb-2">
            <CheckCircle size={14} />
            <span>Info</span>
          </div>
          <p className="text-2xl font-bold font-mono text-green-400">
            {allAlerts.filter(a => a.severity === 'info').length}
          </p>
        </div>
      </div>

      <Card noPadding>
        <CardHeader>
          <span>Alert Attivi</span>
          {liveAlerts.length > 0 && <Badge variant="danger">{liveAlerts.length} live</Badge>}
        </CardHeader>
        <CardBody className="p-0">
          {allAlerts.length === 0 ? (
            <div className="p-8 text-center text-green-400">
              <CheckCircle size={32} className="mx-auto mb-2" />
              <p>Nessun alert attivo</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {allAlerts.map((alert, i) => (
                <div key={i} className={`p-4 flex items-start gap-3 hover:bg-gray-800/50 ${getSeverityBg(alert.severity)}`}>
                  {getSeverityIcon(alert.severity)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{alert.message || alert.msg}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {alert.node && <span>{alert.node}</span>}
                      {alert.type && <span>{alert.type}</span>}
                      {alert.timestamp && (
                        <span>{new Date(alert.timestamp * 1000).toLocaleString('it-IT')}</span>
                      )}
                    </div>
                  </div>
                  <Badge variant={alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info'}>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
