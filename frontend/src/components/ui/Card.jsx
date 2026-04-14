import { clsx } from 'clsx'

export function Card({ children, className, noPadding = false }) {
  return (
    <div className={clsx(
      'bg-gray-900 border border-gray-800 rounded-xl',
      !noPadding && 'overflow-hidden',
      className
    )}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className, actions }) {
  return (
    <div className={clsx(
      'px-4 py-3 border-b border-gray-800 flex items-center justify-between',
      className
    )}>
      <h3 className="font-semibold text-white">{children}</h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ children, className, noPadding = false }) {
  return (
    <div className={clsx(
      !noPadding ? 'p-4' : '',
      className
    )}>
      {children}
    </div>
  )
}

export function CardStat({ label, value, icon, color = 'cyan' }) {
  const colors = {
    cyan: 'text-cyan-400',
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
        {icon && <span className={colors[color]}>{icon}</span>}
      </div>
      <div className={`text-2xl font-bold font-mono ${colors[color]}`}>
        {value}
      </div>
    </div>
  )
}
