import { clsx } from 'clsx'

export function Input({ className, label, error, ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <input
        className={clsx(
          'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg',
          'text-gray-100 placeholder-gray-500',
          'focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
          'transition-colors',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500',
          className
        )}
        {...props}
      />
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

export function Select({ className, label, error, children, ...props }) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-300">
          {label}
        </label>
      )}
      <select
        className={clsx(
          'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg',
          'text-gray-100',
          'focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
          'transition-colors cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={clsx('flex items-center gap-2 cursor-pointer', className)}>
      <input
        type="checkbox"
        className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
        {...props}
      />
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  )
}
