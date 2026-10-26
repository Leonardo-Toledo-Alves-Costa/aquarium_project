import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDismiss } from './hooks'

export interface MenuPosition {
  x: number
  y: number
}

/** Menu flutuante que abre onde foi clicado e não sai da janela. `toggle`: o botão que abriu o menu. */
export function ContextMenu({
  at,
  label,
  toggle,
  onClose,
  children
}: {
  at: MenuPosition
  label: string
  toggle?: HTMLElement
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLElement | null>(null)
  toggleRef.current = toggle ?? null
  const [pos, setPos] = useState(at)
  useDismiss(ref, onClose, true, toggleRef)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - height - 8))
    })
  }, [at])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
  }, [])

  return (
    <div ref={ref} role="menu" aria-label={label} className="menu" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  )
}

export function MenuItem({
  onClick,
  danger,
  children,
  hint
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <button role="menuitem" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      <span>{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator(): React.JSX.Element {
  return <div className="menu-sep" role="separator" />
}

export function MenuTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="menu-title">{children}</div>
}
