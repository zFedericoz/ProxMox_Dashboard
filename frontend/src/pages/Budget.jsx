import { useState, useEffect } from 'react'
import { useApi, useApiAction } from '../hooks/useApi'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { DollarSign, Zap, Server, Save, RefreshCw, AlertTriangle, Lightbulb, ChevronUp, ChevronDown, X } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'

const fmt = {
  eur: (v) => `EUR ${(v || 0).toFixed(2)}`
}

export function Budget() {
  const toast = useToast()
  const { execute, loading: saving } = useApiAction()
  const { data: configData, refetch: refetchConfig } = useApi('/api/budget/config', { immediate: false, refetchInterval: 30000 })
  const { data: clusterNodes } = useApi('/api/cluster/nodes', { refetchInterval: 30000 })
  const { data: proxmoxNodes, refetch: refetchNodes } = useApi('/api/nodes', { refetchInterval: 30000 })

  const [activeTab, setActiveTab] = useState('overview')
  const [config, setConfig] = useState({
    electricity_cost_kwh: 0.28,
    cooling_overhead_pct: 20,
    monthly_connectivity: 50,
    proxmox_subscription_per_node: 10,
    monthly_backup_offsite: 10,
    monthly_budget: 500,
  })

  const [nodes, setNodes] = useState([])
  const [calculations, setCalculations] = useState(null)

  useEffect(() => {
    if (configData) {
      setConfig(prev => ({ ...prev, ...configData }))
      if (configData.nodes) {
        setNodes(configData.nodes)
      }
    }
  }, [configData])

  useEffect(() => {
    if (!proxmoxNodes?.nodes) return
    
    const dbNodes = proxmoxNodes.nodes
    const dbNodeNames = new Set(dbNodes.map(n => n.name))
    
    setNodes(prevNodes => {
      let updated = [...prevNodes]
      const localNodeNames = new Set(updated.map(n => n.name))
      
      const newNodes = dbNodes.filter(n => !localNodeNames.has(n.name))
      for (const n of newNodes) {
        updated.push({
          name: n.name,
          host: n.host,
          zone: n.zone || 'Default',
          enabled: !!n.enabled,
          watt: 50,
          tdp_idle: 20,
          tdp_max: 65,
          hours: 730,
          hw_cost: 800,
          amort_months: 48,
        })
      }
      
      updated = updated.filter(n => dbNodeNames.has(n.name))
      
      for (let i = 0; i < updated.length; i++) {
        const dbNode = dbNodes.find(n => n.name === updated[i].name)
        if (dbNode) {
          updated[i].enabled = !!dbNode.enabled
          updated[i].zone = dbNode.zone || 'Default'
        }
      }
      
      return updated
    })
  }, [proxmoxNodes])

  const calculate = () => {
    const activeNodes = nodes.filter(n => n.enabled)
    const electricityCostPerNode = activeNodes.reduce((acc, node) => {
      const tdp_idle = node.tdp_idle || 20
      const tdp_max = node.tdp_max || 65
      const hours = node.hours || 730
      const wattMonthly = (tdp_idle + (tdp_max - tdp_idle) * (node.watt / 100)) * hours
      const kwh = wattMonthly / 1000
      return acc + (kwh * config.electricity_cost_kwh)
    }, 0)

    const coolingCost = electricityCostPerNode * (config.cooling_overhead_pct / 100)
    const subscriptionCost = activeNodes.length * config.proxmox_subscription_per_node
    const amortizationCost = activeNodes.reduce((acc, node) => {
      const hw_cost = node.hw_cost || 800
      const amort_months = node.amort_months || 48
      return acc + (hw_cost / amort_months)
    }, 0)
    const connectivityCost = config.monthly_connectivity
    const backupCost = config.monthly_backup_offsite

    const totalMonthly = electricityCostPerNode + coolingCost + subscriptionCost + amortizationCost + connectivityCost + backupCost
    const budgetRemaining = config.monthly_budget - totalMonthly
    const budgetUsedPct = (totalMonthly / config.monthly_budget) * 100

    const pieData = [
      { name: 'Elettricita', value: electricityCostPerNode },
      { name: 'Raffreddamento', value: coolingCost },
      { name: 'Connettivita', value: connectivityCost },
      { name: 'Backup', value: backupCost },
      { name: 'Ammortamento', value: amortizationCost },
      { name: 'Subscription', value: subscriptionCost },
    ].filter(d => d.value > 0)

    const nodeCosts = activeNodes.map(node => {
      const tdp_idle = node.tdp_idle || 20
      const tdp_max = node.tdp_max || 65
      const hours = node.hours || 730
      const wattMonthly = (tdp_idle + (tdp_max - tdp_idle) * (node.watt / 100)) * hours
      const kwh = wattMonthly / 1000
      const elCost = kwh * config.electricity_cost_kwh
      const hw_cost = node.hw_cost || 800
      const amort_months = node.amort_months || 48
      const amort = hw_cost / amort_months
      const sub = config.proxmox_subscription_per_node
      return {
        name: node.name,
        zone: node.zone || 'Default',
        watt: node.watt,
        tdp_idle,
        tdp_max,
        hours,
        hw_cost,
        amort_months,
        electricity: elCost,
        amortization: amort,
        subscription: sub,
        total: elCost + amort + sub
      }
    })

    const allZones = [...new Set(nodeCosts.map(n => n.zone))]
    
    const zoneCosts = allZones.map(zone => {
      const zoneNodes = nodeCosts.filter(n => n.zone === zone)
      return {
        zone,
        nodes: zoneNodes.length,
        total: zoneNodes.reduce((acc, n) => acc + n.total, 0),
        electricity: zoneNodes.reduce((acc, n) => acc + n.electricity, 0)
      }
    })

    setCalculations({
      electricityCostPerNode,
      coolingCost,
      subscriptionCost,
      amortizationCost,
      connectivityCost,
      backupCost,
      totalMonthly,
      budgetRemaining,
      budgetUsedPct,
      pieData,
      nodeCosts,
      zoneCosts
    })
  }

  const saveConfig = async () => {
    const result = await execute('/api/budget/config', 'POST', {
      ...config,
      nodes
    })
    if (result.success) {
      toast.success('Configurazione salvata')
    } else {
      toast.error(result.error || 'Errore salvataggio')
    }
  }

  useEffect(() => {
    calculate()
  }, [config, nodes])

  const COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#3b82f6', '#ec4899']

  const tips = []
  if (calculations && calculations.budgetUsedPct > 80) {
    tips.push({ type: 'warning', text: 'Budget quasi esaurito. Valuta spegnimento nodi non utilizzati.' })
  }
  if (calculations && calculations.coolingCost > calculations.electricityCostPerNode * 0.3) {
    tips.push({ type: 'info', text: 'Il costo del raffreddamento e elevato. Investi in un sistema di cooling piu efficiente.' })
  }

  const activeNodes = nodes.filter(n => n.enabled)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'overview' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Panoramica
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'config' ? 'bg-cyan-500 text-gray-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Configurazione
          </button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={calculate} icon={<RefreshCw size={16} />}>
            Ricalcola
          </Button>
          {activeTab === 'config' && (
            <Button size="sm" onClick={saveConfig} loading={saving} icon={<Save size={16} />}>
              Salva
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {activeNodes.length} nodi attivi configurati
      </p>

      {activeTab === 'overview' && calculations && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <DollarSign size={14} />
                <span>Costo Mensile</span>
              </div>
              <p className="text-2xl font-bold font-mono text-cyan-400">{fmt.eur(calculations.totalMonthly)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <Zap size={14} />
                <span>Budget</span>
              </div>
              <p className="text-2xl font-bold font-mono text-purple-400">{fmt.eur(config.monthly_budget)}</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <DollarSign size={14} />
                <span>Rimanente</span>
              </div>
              <p className={`text-2xl font-bold font-mono ${calculations.budgetRemaining > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {fmt.eur(calculations.budgetRemaining)}
              </p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
                <Zap size={14} />
                <span>Utilizzo</span>
              </div>
              <p className={`text-2xl font-bold font-mono ${
                calculations.budgetUsedPct > 90 ? 'text-red-400' : 
                calculations.budgetUsedPct > 75 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {calculations.budgetUsedPct.toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                calculations.budgetUsedPct > 90 ? 'bg-red-500' : 
                calculations.budgetUsedPct > 75 ? 'bg-yellow-500' : 'bg-cyan-500'
              }`} 
              style={{ width: `${Math.min(calculations.budgetUsedPct, 100)}%` }} 
            />
          </div>

          {tips.length > 0 && (
            <div className="space-y-2">
              {tips.map((tip, i) => (
                <div key={i} className={`flex items-start gap-3 p-4 rounded-lg border ${
                  tip.type === 'warning' ? 'bg-yellow-900/20 border-yellow-800' : 'bg-blue-900/20 border-blue-800'
                }`}>
                  <AlertTriangle size={18} className={tip.type === 'warning' ? 'text-yellow-400' : 'text-blue-400'} />
                  <p className="text-sm text-gray-300">{tip.text}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>Ripartizione Costi</CardHeader>
              <CardBody>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={calculations.pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                      >
                        {calculations.pieData.map((entry, index) => (
                          <Cell key={index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => fmt.eur(value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>Dettaglio Voci</CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-gray-800">
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-cyan-400" />
                      <span className="text-gray-300">Elettricita</span>
                    </div>
                    <span className="font-mono text-cyan-400">{fmt.eur(calculations.electricityCostPerNode)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-purple-400" />
                      <span className="text-gray-300">Raffreddamento</span>
                    </div>
                    <span className="font-mono text-purple-400">{fmt.eur(calculations.coolingCost)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <span className="text-gray-300">Connettivita</span>
                    </div>
                    <span className="font-mono text-yellow-400">{fmt.eur(calculations.connectivityCost)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                      <span className="text-gray-300">Backup</span>
                    </div>
                    <span className="font-mono text-green-400">{fmt.eur(calculations.backupCost)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-blue-400" />
                      <span className="text-gray-300">Ammortamento</span>
                    </div>
                    <span className="font-mono text-blue-400">{fmt.eur(calculations.amortizationCost)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full bg-pink-400" />
                      <span className="text-gray-300">Subscription</span>
                    </div>
                    <span className="font-mono text-pink-400">{fmt.eur(calculations.subscriptionCost)}</span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {calculations.zoneCosts.length > 1 && (
            <Card noPadding>
              <CardHeader>Costi per Zona</CardHeader>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-950 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Zona</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nodi</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Elettricita</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Totale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {calculations.zoneCosts.map((zone, i) => (
                      <tr key={i} className="hover:bg-gray-800/50">
                        <td className="px-4 py-3 text-purple-400 font-medium">{zone.zone}</td>
                        <td className="px-4 py-3 font-mono text-gray-300">{zone.nodes}</td>
                        <td className="px-4 py-3 font-mono text-gray-300">{fmt.eur(zone.electricity)}</td>
                        <td className="px-4 py-3 font-mono text-orange-400 font-semibold">{fmt.eur(zone.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

          <Card noPadding>
            <CardHeader>Costi per Nodo</CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nodo</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Zona</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Watt Stima</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Elettricita</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ammortamento</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Subscription</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Totale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {calculations.nodeCosts.map((node, i) => (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3 text-cyan-400 font-medium">{node.name}</td>
                      <td className="px-4 py-3 text-purple-400">{node.zone}</td>
                      <td className="px-4 py-3 font-mono text-gray-300">
                        {nodes.find(n => n.name === node.name)?.watt || 0}%
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-300">{fmt.eur(node.electricity)}</td>
                      <td className="px-4 py-3 font-mono text-gray-300">{fmt.eur(node.amortization)}</td>
                      <td className="px-4 py-3 font-mono text-gray-300">{fmt.eur(node.subscription)}</td>
                      <td className="px-4 py-3 font-mono text-orange-400 font-semibold">{fmt.eur(node.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}

      {activeTab === 'config' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>Costi Elettrici Globali</CardHeader>
              <CardBody className="space-y-4">
                <Input
                  label="Costo kWh (EUR)"
                  type="number"
                  step="0.01"
                  value={config.electricity_cost_kwh}
                  onChange={(e) => setConfig({ ...config, electricity_cost_kwh: parseFloat(e.target.value) || 0 })}
                />
                <Input
                  label="Overhead Raffreddamento (%)"
                  type="number"
                  value={config.cooling_overhead_pct}
                  onChange={(e) => setConfig({ ...config, cooling_overhead_pct: parseFloat(e.target.value) || 0 })}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>Costi Fissi Globali</CardHeader>
              <CardBody className="space-y-4">
                <Input
                  label="Connettivita mensile (EUR)"
                  type="number"
                  value={config.monthly_connectivity}
                  onChange={(e) => setConfig({ ...config, monthly_connectivity: parseFloat(e.target.value) || 0 })}
                />
                <Input
                  label="Subscription per nodo (EUR)"
                  type="number"
                  value={config.proxmox_subscription_per_node}
                  onChange={(e) => setConfig({ ...config, proxmox_subscription_per_node: parseFloat(e.target.value) || 0 })}
                />
                <Input
                  label="Backup Offsite mensile (EUR)"
                  type="number"
                  value={config.monthly_backup_offsite}
                  onChange={(e) => setConfig({ ...config, monthly_backup_offsite: parseFloat(e.target.value) || 0 })}
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>Budget Mensile</CardHeader>
            <CardBody className="max-w-xs">
              <Input
                label="Budget Mensile (EUR)"
                type="number"
                value={config.monthly_budget}
                onChange={(e) => setConfig({ ...config, monthly_budget: parseFloat(e.target.value) || 0 })}
              />
            </CardBody>
          </Card>

          <Card noPadding>
            <CardHeader>Configurazione Costi per Nodo</CardHeader>
            <CardBody className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-950 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Abilitato</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Nome Nodo</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">CPU %</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Watt Idle</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Watt Max</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Ore/Mese</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Costo HW</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Amort (mesi)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {nodes.map((node, i) => (
                    <tr key={i} className="hover:bg-gray-800/50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={node.enabled}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].enabled = e.target.checked
                            setNodes(newNodes)
                          }}
                          className="rounded border-gray-600 bg-gray-800 text-cyan-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-cyan-400 font-medium">{node.name}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={node.watt}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].watt = parseInt(e.target.value) || 0
                            setNodes(newNodes)
                          }}
                          className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          value={node.tdp_idle || 20}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].tdp_idle = parseInt(e.target.value) || 0
                            setNodes(newNodes)
                          }}
                          className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          value={node.tdp_max || 65}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].tdp_max = parseInt(e.target.value) || 0
                            setNodes(newNodes)
                          }}
                          className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          value={node.hours || 730}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].hours = parseInt(e.target.value) || 0
                            setNodes(newNodes)
                          }}
                          className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="0"
                          value={node.hw_cost || 800}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].hw_cost = parseInt(e.target.value) || 0
                            setNodes(newNodes)
                          }}
                          className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min="1"
                          value={node.amort_months || 48}
                          onChange={(e) => {
                            const newNodes = [...nodes]
                            newNodes[i].amort_months = parseInt(e.target.value) || 48
                            setNodes(newNodes)
                          }}
                          className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-gray-100 text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nodes.length === 0 && (
                <div className="p-8 text-center text-gray-500">Nessun nodo configurato. Aggiungi nodi nelle Impostazioni.</div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
