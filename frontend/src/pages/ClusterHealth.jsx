import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge, StatusBadge } from '../components/ui/Badge'
import { formatDate } from '../utils/dateUtils'
import { 
  Server, Activity, AlertTriangle, CheckCircle2, XCircle, 
  Shield, ArrowRight, Cpu, HardDrive, MemoryStick
} from 'lucide-react'

const HealthIndicator = ({ status }) => {
  const colors = {
    healthy: 'text-green-400',
    warning: 'text-yellow-400',
    critical: 'text-red-400',
    error: 'text-red-500',
    no_nodes: 'text-gray-400'
  }
  const icons = {
    healthy: <CheckCircle2 size={20} />,
    warning: <AlertTriangle size={20} />,
    critical: <XCircle size={20} />,
    error: <XCircle size={20} />,
    no_nodes: <XCircle size={20} />
  }
  
  return (
    <div className={`flex items-center gap-2 ${colors[status] || 'text-gray-400'}`}>
      {icons[status]}
      <span className="font-medium capitalize">{status}</span>
    </div>
  )
}

export function ClusterHealth() {
  const { data: healthData, loading, refetch } = useApi('/api/cluster/health', { 
    refetchInterval: 30000 
  })
  const { data: drsData } = useApi('/api/cluster/drs', { 
    refetchInterval: 60000 
  })
  const { data: placementData } = useApi('/api/cluster/placement', { 
    refetchInterval: 60000 
  })
  const { data: summary } = useApi('/api/cluster/summary')

  const health = healthData || {}
  const drs = drsData || {}
  const placement = placementData || {}
  const clusterSummary = summary || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Cluster Health</h1>
          <p className="text-sm text-gray-400 mt-1">Monitoraggio stato cluster, HA e raccomandazioni DRS</p>
        </div>
        <button 
          onClick={() => refetch()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2"
        >
          <Activity size={16} />
          Refresh
        </button>
      </div>

      {/* Cluster Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-900/50">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Stato Cluster</p>
              <HealthIndicator status={health.status} />
            </div>
            <Shield size={32} className="text-cyan-400" />
          </CardBody>
        </Card>

        <Card className="bg-gray-900/50">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Quorum</p>
              <p className={`text-lg font-bold ${health.quorum ? 'text-green-400' : 'text-red-400'}`}>
                {health.quorum ? 'Attivo' : 'Perso'}
              </p>
            </div>
            {health.quorum ? <CheckCircle2 size={32} className="text-green-400" /> : <XCircle size={32} className="text-red-400" />}
          </CardBody>
        </Card>

        <Card className="bg-gray-900/50">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Nodi</p>
              <p className="text-lg font-bold text-white">
                {health.nodes?.filter(n => n.online).length || 0} / {health.nodes?.length || 0}
              </p>
              <p className="text-xs text-gray-500">online</p>
            </div>
            <Server size={32} className="text-cyan-400" />
          </CardBody>
        </Card>

        <Card className="bg-gray-900/50">
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">HA</p>
              <p className={`text-lg font-bold ${health.ha_status?.enabled ? 'text-green-400' : 'text-gray-400'}`}>
                {health.ha_status?.enabled ? 'Abilitato' : 'Non configurato'}
              </p>
            </div>
            {health.ha_status?.enabled ? <Shield size={32} className="text-green-400" /> : <Shield size={32} className="text-gray-500" />}
          </CardBody>
        </Card>
      </div>

      {/* Issues & Warnings */}
      {(health.issues?.length > 0 || health.warnings?.length > 0) && (
        <Card noPadding>
          <CardHeader className="bg-red-900/20">
            <div className="flex items-center gap-2">
              <AlertTriangle size={20} className="text-red-400" />
              <span>Problemi Cluster ({health.issues?.length || 0} critici, {health.warnings?.length || 0} warnings)</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-gray-800">
              {(health.issues || []).map((issue, i) => (
                <div key={`issue-${i}`} className="p-4 flex items-start gap-3 bg-red-900/10">
                  <XCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-red-400 font-medium">{issue.message}</p>
                    {issue.suggestion && <p className="text-gray-400 text-sm mt-1">{issue.suggestion}</p>}
                    {issue.node && <p className="text-gray-500 text-xs mt-1">Nodo: {issue.node}</p>}
                  </div>
                </div>
              ))}
              {(health.warnings || []).map((warning, i) => (
                <div key={`warn-${i}`} className="p-4 flex items-start gap-3 bg-yellow-900/10">
                  <AlertTriangle size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-yellow-400 font-medium">{warning.message}</p>
                    {warning.node && <p className="text-gray-500 text-xs mt-1">Nodo: {warning.node}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* DRS Recommendations */}
      <Card noPadding>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-cyan-400" />
            <span>DRS - Bilanciamento Cluster</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {drs.enabled ? (
            <div className="divide-y divide-gray-800">
              {/* Node Scores */}
              <div className="p-4">
                <p className="text-gray-400 text-sm mb-3">Score bilanciamento nodi (0-100):</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(drs.nodes || []).map((node) => (
                    <div key={node.name} className="bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-medium">{node.name}</span>
                        <Badge variant={node.status === 'balanced' ? 'success' : node.status === 'imbalanced' ? 'danger' : 'warning'}>
                          {node.status}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-400">CPU</span>
                          <span className={node.cpu_usage > 80 ? 'text-red-400' : 'text-gray-300'}>{node.cpu_usage?.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">RAM</span>
                          <span className={node.mem_percent > 85 ? 'text-red-400' : 'text-gray-300'}>{node.mem_percent?.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Disk</span>
                          <span className={node.disk_percent > 90 ? 'text-red-400' : 'text-gray-300'}>{node.disk_percent?.toFixed(1)}%</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-700 flex justify-between">
                          <span className="text-gray-400">Score</span>
                          <span className={`font-bold ${node.balance_score > 60 ? 'text-green-400' : node.balance_score < 40 ? 'text-red-400' : 'text-yellow-400'}`}>
                            {node.balance_score}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              {(drs.recommendations || []).length > 0 && (
                <div className="p-4 bg-cyan-900/10">
                  <p className="text-cyan-400 text-sm mb-3">Raccomandazioni:</p>
                  <div className="space-y-2">
                    {(drs.recommendations || []).map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg">
                        <ArrowRight size={16} className="text-cyan-400 mt-1 flex-shrink-0" />
                        <div>
                          <p className="text-white text-sm">{rec.message}</p>
                          <p className="text-gray-400 text-xs mt-1">{rec.action}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              <Activity size={48} className="mx-auto mb-4 opacity-50" />
              <p>{drs.message || "DRS non disponibile"}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* VM Placement Suggestion */}
      <Card noPadding>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server size={20} className="text-cyan-400" />
            <span>Suggerimento Placement VM</span>
          </div>
        </CardHeader>
        <CardBody>
          {placement.recommended ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-400 text-sm mb-1">Nodo consigliato</p>
                <p className="text-2xl font-bold text-white">{placement.recommended.name}</p>
                <p className="text-gray-400 text-sm mt-1">{placement.recommended.reason}</p>
                <p className="text-gray-500 text-xs mt-2">Score: {placement.recommended.score}</p>
              </div>
              {(placement.nodes || []).slice(0, 2).map((node, i) => (
                <div key={node.name} className="bg-gray-800 rounded-lg p-4">
                  <p className="text-gray-400 text-sm mb-1">{i === 0 ? '2° scelta' : '3° scelta'}</p>
                  <p className="text-xl font-bold text-white">{node.name}</p>
                  <div className="mt-2 space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>CPU disp.</span>
                      <span>{node.cpu_available}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>RAM disp.</span>
                      <span>{node.mem_available}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Disk disp.</span>
                      <span>{node.disk_available}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center">Nessun nodo disponibile per suggerimento</p>
          )}
        </CardBody>
      </Card>

      {/* Node Details */}
      <Card noPadding>
        <CardHeader>Dettagli Nodi Cluster</CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-950 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nodo</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">IP</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Livello</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Locale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {(health.nodes || []).map((node, i) => (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-cyan-400 font-medium">{node.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={node.online ? 'online' : 'offline'} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono">{node.ip || '-'}</td>
                  <td className="px-4 py-3 text-gray-400">{node.level || '-'}</td>
                  <td className="px-4 py-3">
                    {node.local ? <CheckCircle2 size={16} className="text-green-400" /> : <XCircle size={16} className="text-gray-600" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(health.nodes || []).length === 0 && (
            <div className="p-8 text-center text-gray-500">
              <Server size={48} className="mx-auto mb-4 opacity-50" />
              <p>Nessun nodo rilevato</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* HA Resources */}
      {(health.ha_status?.resources?.length > 0) && (
        <Card noPadding>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield size={20} className="text-green-400" />
              <span>HA Resources ({health.ha_status.resources.length})</span>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-950 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Resource</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Stato</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {health.ha_status.resources.map((res, i) => (
                  <tr key={i} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-cyan-400">{res.sid || res.name || `Resource ${i+1}`}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={res.state === 'running' ? 'running' : 'stopped'} />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{res.type || '-'}</td>
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