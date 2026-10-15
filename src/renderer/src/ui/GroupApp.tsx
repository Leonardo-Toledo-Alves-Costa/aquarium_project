import { useEffect, useState } from 'react'
import { deriveGroupKeys } from '../group/group-code'
import { RoomSession } from '../rtc/room-session'
import { getSettings, serverUrlOf, sessionSettings, useSettings } from '../settings'
import { RoomClient } from '../signaling/rooms'
import { Palco } from './Palco'

/** Conecta ao grupo e mantém a conexão viva enquanto o app está aberto. */
export function GroupApp({
  code,
  onLeaveGroup,
  onManual
}: {
  code: string
  onLeaveGroup: () => void
  onManual: () => void
}): React.JSX.Element {
  const settings = useSettings()
  const [conn, setConn] = useState<{ client: RoomClient; session: RoomSession } | null>(null)

  useEffect(() => {
    let cancelled = false
    let made: { client: RoomClient; session: RoomSession } | null = null
    deriveGroupKeys(code).then((keys) => {
      if (cancelled) return
      const current = getSettings()
      const client = new RoomClient({ serverUrl: serverUrlOf(current), keys, peerId: current.peerId, name: current.name })
      const session = new RoomSession(client, sessionSettings(current))
      made = { client, session }
      setConn(made)
    })
    return () => {
      cancelled = true
      made?.session.close()
      made?.client.close()
      setConn(null)
    }
  }, [code, settings.serverUrl, settings.peerId])

  useEffect(() => {
    if (conn && settings.name) conn.client.setName(settings.name)
  }, [conn, settings.name])

  useEffect(() => {
    conn?.session.updateSettings(sessionSettings(settings))
  }, [conn, settings.presetId, settings.priority, settings.codec, settings.bandwidth])

  if (!conn) {
    return (
      <div className="splash" role="status">
        Conectando ao grupo…
      </div>
    )
  }
  return <Palco client={conn.client} session={conn.session} groupCode={code} onLeaveGroup={onLeaveGroup} onManual={onManual} />
}
