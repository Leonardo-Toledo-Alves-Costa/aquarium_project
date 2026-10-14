// Ícones em traço, herdando a cor do texto.

type IconProps = { size?: number }

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export const IconTank = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M3 13c2.5-2 4.5-2 7 0s4.5 2 7 0" />
  </Svg>
)

export const IconScreen = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
)

export const IconSpeaker = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
)

export const IconSpeakerOff = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </Svg>
)

export const IconSliders = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h12M20 18h0" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
)

export const IconSideBySide = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="8" height="16" rx="1.5" />
    <rect x="13" y="4" width="8" height="16" rx="1.5" />
  </Svg>
)

export const IconFocus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="11" rx="1.5" />
    <path d="M4 19h4M10 19h4M16 19h4" />
  </Svg>
)

export const IconGear = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)

export const IconUsers = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
  </Svg>
)

export const IconEye = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const IconChevronDown = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconPlus = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconClose = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconMore = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Svg>
)

export const IconSignal = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 18v-2M9 18v-6M14 18v-10M19 18V4" />
  </Svg>
)

export const IconLock = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
)
