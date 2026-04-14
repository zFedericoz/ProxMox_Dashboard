import { clsx } from 'clsx'

const variants = {
  primary: 'bg-cyan-500 text-gray-900 hover:bg-cyan-400 active:bg-cyan-600',
  danger: 'bg-red-600 text-white hover:bg-red-500 active:bg-red-700',
  ghost: 'bg-transparent text-gray-300 hover:bg-gray-800 hover:text-white',
  outline: 'bg-transparent border border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white',
  success: 'bg-green-600 text-white hover:bg-green-500 active:bg-green-700',
  warning: 'bg-yellow-600 text-white hover:bg-yellow-500 active:bg-yellow-700',
}

const sizes = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className, 
  loading,
  disabled,
  icon,
  ...props 
}) {
  return (
    <button
      className={clsx(
        'rounded-lg font-medium transition-all duration-200 inline-flex items-center justify-center gap-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : icon}
      {children}
    </button>
  )
}
