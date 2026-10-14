// Cor estável por pessoa, derivada do id (a mesma em todos os PCs).
const COLORS = ['#4cc3cd', '#e0a24a', '#a99cf2', '#6fcf97', '#f08aa8', '#7fb4f0', '#e5c15a', '#d7926b']

export function colorFor(peerId: string): string {
  let hash = 0
  for (const char of peerId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

export function Avatar({ peerId, name, size = 28 }: { peerId: string; name: string; size?: number }): React.JSX.Element {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: colorFor(peerId) }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
