import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge, StatusBadge } from '../components/ui/Badge'
import {
  Server, Activity, AlertTriangle, CheckCircle2, XCircle,
  Shield, ArrowRight, Layers, Wifi, WifiOff, Cpu, MemoryStick, HardDrive
} from 'lucide-react'

const fmt = {
  pct: (v) => `${(v || 0).toFixed(1)}%`,
}

const HealthIndicator = ({ status }) => {
  const colors = {
    healthy: 'text-green-400', warning: 'text-yellow-400',
    critical: 'text-red-400', error: 'text-red-500', no_nodes: 'text-gray-400'
  }
  const icons = {
    healthy: <CheckCircle2 size={20} />, warning: <AlertTriangle size={20} />,
    critical: <XCircle size={20} />, error: <XCircle size={20} />, no_nodes: <XCircle size={20} />
  }
  return (
    <div className={`flex items-center gap-2 ${colors[status] || 'text-gray-400'}`}>
      {icons[status]}
      <span className="font-medium capitalize">{status}</span>
    </div>
  )
}

export function ClusterHealth() {
  const [activeCluster, setActiveCluster] = useState(null)
  const { data: clustersData } = useApi('/api/clusters', { refetchInterval: 30000 })
  const { data: summary } = useApi('/api/cluster/summary', { refetchInterval: 20000 })

  const clusters = clustersData?.clusters || []
  const allLiveNodes = summary?.nodes || []

  const selectedId = activeCluster ?? (clusters[0]?.id ?? null)
  const selectedCluster = clusters.find(c => c.id === selectedId) || clusters[0]

  // Endpoints with cluster filter
  const healthEndpoint = selectedId ? `/api/cluster/health?cluster_id=${selectedId}` : '/api/cluster/health'
  const drsEndpoint = selectedId ? `/api/cluster/drs?cluster_id=${selectedId}` : '/api/cluster/drs'
  const placementEndpoint = selectedId ? `/api/cluster/placement?cluster_id=${selectedId}` : '/api/cluster/placement'

  const { data: healthData, loading, refetch } = useApi(healthEndpoint, { refetchInterval: 30000 })
  const { data: drsData } = useApi(drsEndpoint, { refetchInterval: 60000 })
  const { data: placementData } = useApi(placementEndpoint, { refetchInterval: 60000 })

  const health = healthData || {}
  const drs = drsData || {}
  const placement = placementData || {}

  // Get live metrics for nodes in selected cluster
  const clusterNodeNames = new Set((selectedCluster?.nodes || []).map(n => n.name))
  const liveNodes = allLiveNodes.filter(n => clusterNodeNames.has(n.name))

  // Health nodes filtered to selected cluster
  const healthNodes = (health.nodes || []).filter(n => clusterNodeNames.has(n.name))

  // Issues/warnings filtered to selected cluster
  const clusterIssues = (health.issues || []).filter(i => !i.node || clusterNodeNames.has(i.node))
  const clusterWarnings = (health.warnings || []).filter(w => !w.node || clusterNodeNames.has(w.node))

  // DRS nodes filtered to selected cluster
  const drsNodes = (drs.nodes || []).filter(n => clusterNodeNames.has(n.name))

  const onlineCount = liveNodes.filter(n => n.status === 'online').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Cluster Health</h1>
          <p className="text-sm text-gray-400 mt-1">Monitoraggio stato cluster, HA e raccomandazioni DRS</p>
        </div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center gap-2"
        >
          <Activity size={16} /> Refresh
        </button>
      </div>

      {/* Cluster tabs */}
      {clusters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <Layers size={48} className="mb-4 opacity-30" />
          <p className="text-lg">Nessun cluster configurato</p>
          <p className="text-sm mt-1">Crea un cluster nella sezione Impostazioni e assegna i nodi.</p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-gray-800 overflow-x-auto">
            {clusters.map(c => {
              const cNames = new Set((c.nodes || []).map(n => n.name))
              const cLive = allLiveNodes.filter(n => cNames.has(n.name))
              const cOnline = cLive.filter(n => n.status === 'online').length
              const isActive = c.id === selectedId
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCluster(c.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? 'border-cyan-400 text-white bg-gray-800/40'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/20'
                  }`}
                >
                  <Layers size={14} />
                  {c.name}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    cOnline === cLive.length && cLive.length > 0 ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {cOnline}/{cLive.length}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          {selectedCluster && (
            <div className="space-y-6">

              {/* Status bar for this cluster */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Stato Cluster" icon={<Shield size={28} className="text-cyan-400" />}>
                  <HealthIndicator status={health.status} />
                </StatCard>
                <StatCard label="Quorum" icon={health.quorum
                  ? <CheckCircle2 size={28} className="text-green-400" />
                  : <XCircle size={28} className="text-red-400" />}>
                  <p className={`text-lg font-bold ${health.quorum ? 'text-green-400' : 'text-red-400'}`}>
                    {health.quorum ? 'Attivo' : 'Perso'}
                  </p>
                </StatCard>
                <StatCard label="Nodi" icon={<Server size={28} className="text-cyan-400" />}>
                  <p className="text-lg font-bold text-white">{onlineCount} / {liveNodes.length}</p>
                  <p className="text-xs text-gray-500">online</p>
                </StatCard>
                <StatCard label="HA" icon={<Shield size={28} className={health.ha_status?.enabled ? 'text-green-400' : 'text-gray-500'} />}>
                  <p className={`text-lg font-bold ${health.ha_status?.enabled ? 'text-green-400' : 'text-gray-400'}`}>
                    {health.ha_status?.enabled ? 'Abilitato' : 'Non configurato'}
                  </p>
                </StatCard>
              </div>

              {/* Issues & Warnings */}
              {(clusterIssues.length > 0 || clusterWarnings.length > 0) && (
                <Card noPadding>
                  <CardHeader className="bg-red-900/20">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={18} className="text-red-400" />
                      <span>Problemi ({clusterIssues.length} critici, {clusterWarnings.length} warnings)</span>
                    </div>
                  </CardHeader>
                  <CardBody className="p-0">
                    <div className="divide-y divide-gray-800">
                      {clusterIssues.map((issue, i) => (
                        <div key={`i-${i}`} className="p-4 flex items-start gap-3 bg-red-900/10">
                          <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-red-400 font-medium">{issue.message}</p>
                            {issue.suggestion && <p className="text-gray-400 text-sm mt-1">{issue.suggestion}</p>}
                            {issue.node && <p className="text-gray-500 text-xs mt-1">Nodo: {issue.node}</p>}
                          </div>
                        </div>
                      ))}
                      {clusterWarnings.map((w, i) => (
                        <div key={`w-${i}`} className="p-4 flex items-start gap-3 bg-yellow-900/10">
                          <AlertTriangle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-yellow-400 font-medium">{w.message}</p>
                            {w.node && <p className="text-gray-500 text-xs mt-1">Nodo: {w.node}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Node cards for this cluster */}
              <div>
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Nodi del Cluster</h3>
                {liveNodes.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">
                    <Server size={36} className="mx-auto mb-3 opacity-30" />
                    <p>Nessun nodo assegnato a questo cluster</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {liveNodes.map(node => <ClusterNodeCard key={node.name} node={node} healthNodes={healthNodes} />)}
                  </div>
                )}
              </div>

              {/* DRS for this cluster */}
              {drsNodes.length > 0 && (
                <Card noPadding>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Activity size={18} className="text-cyan-400" />
                      <span>DRS — Bilanciamento nodi</span>
                    </div>
                  </CardHeader>
                  <CardBody className="p-0">
                    <div className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {drsNodes.map(node => (
                          <div key={node.name} className="bg-gray-800 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-white font-medium">{node.name}</span>
                              <Badge variant={node.status === 'balanced' ? 'success' : node.status === 'imbalanced' ? 'danger' : 'warning'}>
                                {node.status}
                              </Badge>
                            </div>
                            <div className="space-y-1 text-xs">
                              <MetricRow label="CPU" value={`${node.cpu_usage?.toFixed(1)}%`} warn={node.cpu_usage > 80} />
                              <MetricRow label="RAM" value={`${node.mem_percent?.toFixed(1)}%`} warn={node.mem_percent > 85} />
                              <MetricRow label="Disk" value={`${node.disk_percent?.toFixed(1)}%`} warn={node.disk_percent > 90} />
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
                    {(drs.recommendations || []).length > 0 && (
                      <div className="p-4 border-t border-gray-800 bg-cyan-900/10">
                        <p className="text-cyan-400 text-sm mb-3">Raccomandazioni:</p>
                        <div className="space-y-2">
                          {drs.recommendations.map((rec, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg">
                              <ArrowRight size={14} className="text-cyan-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-white text-sm">{rec.message}</p>
                                <p className="text-gray-400 text-xs mt-1">{rec.action}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}

              {/* VM Placement */}
              {placement.recommended && (
                <Card noPadding>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Server size={18} className="text-cyan-400" />
                      <span>Suggerimento Placement VM</span>
                    </div>
                  </CardHeader>
                  <CardBody>
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
                            <MetricRow label="CPU disp." value={`${node.cpu_available}%`} />
                            <MetricRow label="RAM disp." value={`${node.mem_available}%`} />
                            <MetricRow label="Disk disp." value={`${node.disk_available}%`} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* HA Resources */}
              {(health.ha_status?.resources?.length > 0) && (
                <Card noPadding>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Shield size={18} className="text-green-400" />
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
                            <td className="px-4 py-3 text-cyan-400">{res.sid || res.name || `Resource ${i + 1}`}</td>
                            <td className="px-4 py-3"><StatusBadge status={res.state === 'running' ? 'running' : 'stopped'} /></td>
                            <td className="px-4 py-3 text-gray-400">{res.type || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardBody>
                </Card>
              )}

            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Node card with live metrics ───────────────────────────────────────────────
function ClusterNodeCard({ node, healthNodes }) {
  const hNode = healthNodes.find(h => h.name === node.name)
  const online = node.status === 'online'

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${online ? 'border-gray-700 bg-gray-900/60' : 'border-red-900/40 bg-red-950/20'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {online
            ? <Wifi size={14} className="text-green-400" />
            : <WifiOff size={14} className="text-red-400" />}
          <span className="font-semibold text-white">{node.name}</span>
        </div>
        <StatusBadge status={node.status} />
      </div>
      <p className="text-xs text-gray-500 font-mono -mt-1">{node.host}</p>

      {online ? (
        <>
          {/* Metric bars */}
          <div className="space-y-2">
            <GaugeRow icon={<Cpu size={12} />} label="CPU" value={node.cpu_usage} color="cyan" />
            <GaugeRow icon={<MemoryStick size={12} />} label="RAM" value={node.mem_percent} color="purple" />
            <GaugeRow icon={<HardDrive size={12} />} label="Disco" value={node.disk_percent} color="green" />
          </div>
          {/* Details */}
          <div className="pt-3 border-t border-gray-800 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <InfoPair label="Core" value={node.cpu_cores} />
            <InfoPair label="Uptime" value={node.uptime_str} />
            <InfoPair label="VMs" value={node.vm_count ?? '-'} />
            <InfoPair label="CT" value={node.ct_count ?? '-'} />
            {hNode?.ip && <InfoPair label="IP" value={hNode.ip} />}
            {hNode?.level !== undefined && <InfoPair label="Livello" value={hNode.level || '-'} />}
          </div>
        </>
      ) : (
        <div className="text-center py-4 text-red-400 text-sm">
          <XCircle size={24} className="mx-auto mb-1 opacity-50" />
          <p>{node.error || 'Nodo non raggiungibile'}</p>
        </div>
      )}
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function StatCard({ label, icon, children }) {
  return (
    <Card>
      <CardBody className="flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-sm mb-1">{label}</p>
          {children}
        </div>
        {icon}
      </CardBody>
    </Card>
  )
}

function GaugeRow({ icon, label, value, color }) {
  const pct = Math.min(value || 0, 100)
  const barColor = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : `bg-${color}-500`
  const textColor = `text-${color}-400`
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500 w-3">{icon}</span>
      <span className="text-gray-500 w-8">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono w-10 text-right ${textColor}`}>{pct.toFixed(1)}%</span>
    </div>
  )
}

function InfoPair({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono">{value ?? 'N/A'}</span>
    </div>
  )
}

function MetricRow({ label, value, warn }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={warn ? 'text-red-400' : 'text-gray-300'}>{value}</span>
    </div>
  )
}
