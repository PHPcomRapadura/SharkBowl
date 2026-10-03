import { QRCodeSVG } from 'qrcode.react'
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { Action, AppState, Identity, LobbyState, QueueEntry, Question, Room, RoomSummary } from './types'
import { buildPublicRoomUrl } from './share-url'
import { applyTheme, getPreferredTheme, themeStorageKey, type Theme } from './theme'
import { ApiError, pocketbase, publicAppOrigin, requestJson, toIdentity } from './pocketbase'

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void }>({ theme: 'dark', toggleTheme: () => undefined })
const roomPath = (slug: string) => `/s/${encodeURIComponent(slug)}`
const facilitatorPath = (slug: string) => `${roomPath(slug)}/facilitador`

const formatClock = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

const formatRelativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'agora'
  if (minutes === 1) return 'há 1 min'
  return `há ${minutes} min`
}

const getInitials = (name: string) => name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '??'

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Shark Bowl, salas">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 40" role="img">
          <path d="M4 30c8-9 16-13 25-13 5 0 10 1 15 4-5 0-9 2-12 6 4-1 8-1 12 1-8 7-19 9-31 5L4 30Z" />
          <path className="brand-fin" d="M23 17 29 4l6 13" />
          <circle cx="35" cy="22" r="1.6" />
        </svg>
      </span>
      <span><strong>Shark</strong> <em>Bowl</em></span>
    </a>
  )
}

function ConnectionStatus({ online }: { online: boolean }) {
  return (
    <span className={`connection ${online ? 'is-online' : 'is-offline'}`}>
      <span className="connection-dot" />
      {online ? 'ao vivo' : 'reconectando'}
    </span>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useContext(ThemeContext)
  const dark = theme === 'dark'
  const label = dark ? 'Usar tema claro' : 'Usar tema escuro'
  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
      {dark ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.3 15.7A9 9 0 0 1 8.3 3.7 9 9 0 1 0 20.3 15.7Z" /></svg>}
    </button>
  )
}

function RoomShare({ room, publicOrigin, prominent = false }: { room: Room; publicOrigin: string | null | undefined; prominent?: boolean }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareUrl = publicOrigin ? buildPublicRoomUrl(publicOrigin, room.slug) : ''

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      const temporary = document.createElement('textarea')
      temporary.value = shareUrl
      temporary.style.position = 'fixed'
      temporary.style.opacity = '0'
      document.body.appendChild(temporary)
      temporary.select()
      document.execCommand('copy')
      temporary.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <>
      <button className={prominent ? 'button button-primary share-button' : 'share-trigger'} type="button" onClick={() => setOpen(true)} disabled={publicOrigin === undefined}>
        <span className="qr-mini" aria-hidden="true"><i /><i /><i /><i /></span>
        {publicOrigin === null ? 'Configurar compartilhamento' : prominent ? 'Mostrar QR Code' : 'Compartilhar'}
      </button>
      {open && (
        <div className="share-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false) }}>
          <section className="share-dialog panel-enter" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <button className="share-close" type="button" onClick={() => setOpen(false)} aria-label="Fechar QR Code">×</button>
            <span className="kicker">entrada da sala</span>
            <h2 id="share-title">{shareUrl ? 'Aponte a câmera e entre.' : 'Falta o endereço público.'}</h2>
            {shareUrl ? <><p>Este QR abre <strong>{room.title}</strong> na tela de participante.</p><div className="qr-frame"><QRCodeSVG value={shareUrl} size={224} level="M" includeMargin title={`QR Code para entrar em ${room.title}`} /></div><div className="share-link"><span>{shareUrl}</span><button type="button" onClick={copyLink}>{copied ? 'Copiado' : 'Copiar link'}</button></div><small>O link não inclui o acesso do facilitador.</small></> : <div className="qr-unavailable"><span>!</span><p>Defina <code>VITE_PUBLIC_APP_URL</code> com a origem exposta aos participantes e gere novamente o build.</p></div>}
          </section>
        </div>
      )}
    </>
  )
}

function Header({ online, identity, onLogout, room, publicOrigin, facilitator, canFacilitate = false }: { online: boolean; identity: Identity; onLogout: () => void; room?: Room; publicOrigin?: string | null; facilitator?: boolean; canFacilitate?: boolean }) {
  const [accountOpen, setAccountOpen] = useState(false)

  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-actions">
        <ThemeToggle />
        <ConnectionStatus online={online} />
        {room && <RoomShare room={room} publicOrigin={publicOrigin} />}
        {room && (facilitator || canFacilitate) && <a className="mode-link" href={facilitator ? roomPath(room.slug) : facilitatorPath(room.slug)}>{facilitator ? 'Participar' : 'Facilitar'}</a>}
        <div className="account-control" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape') { setAccountOpen(false); event.currentTarget.querySelector('button')?.focus() } }}>
          <button className="identity-control" type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-controls="account-options" aria-label={`Conta de ${identity.name}`}>
            <span className="avatar avatar-tiny">{getInitials(identity.name)}</span>
            <span>{identity.name}</span>
          </button>
          {accountOpen && <div className="account-options" id="account-options"><button type="button" onClick={onLogout}>Sair da conta</button></div>}
        </div>
      </div>
    </header>
  )
}

function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="notice" role="status">
      <span>{message}</span>
      <button className="icon-button" type="button" onClick={onDismiss} aria-label="Fechar aviso">×</button>
    </div>
  )
}

function IdentityGate({ error, onLogin }: { error: string; onLogin: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false)

  const login = () => {
    if (submitting) return
    setSubmitting(true)
    void onLogin().finally(() => setSubmitting(false))
  }

  return (
    <div className="app-shell auth-shell">
      <header className="topbar"><Brand /><ThemeToggle /></header>
      <main className="auth-main">
        <section className="identity-card panel-enter">
          <div className="identity-orbit" aria-hidden="true"><span>?</span></div>
          <div className="identity-copy">
            <span className="kicker">antes de mergulhar</span>
            <h1>Como podemos te chamar?</h1>
            <p>Entre com sua conta do GitHub para participar, criar salas e manter a conversa segura. Nas perguntas, você ainda pode escolher aparecer como anônimo.</p>
            <div className="identity-form">
              <button className="button button-primary github-login" type="button" onClick={login} disabled={submitting}>{submitting ? 'Abrindo GitHub…' : 'Entrar com GitHub'}</button>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
          </div>
        </section>
      </main>
    </div>
  )
}

function LobbyView({ identity, onLogout, onUnauthorized }: { identity: Identity; onLogout: () => void; onUnauthorized: () => void }) {
  const [lobby, setLobby] = useState<LobbyState | null>(null)
  const [online, setOnline] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => Promise<void>) | undefined
    const load = async () => {
      try {
        const nextLobby = await requestJson<LobbyState>('/lobby')
        if (!cancelled) setLobby(nextLobby)
      } catch (error) {
        if (!cancelled && error instanceof ApiError && error.status === 401) onUnauthorized()
        else if (!cancelled) setMessage(error instanceof Error ? error.message : 'Não foi possível abrir o lobby.')
      }
    }
    const connect = async () => {
      await load()
      if (cancelled) return
      try {
        unsubscribe = await pocketbase.collection('rooms').subscribe('*', () => { void load() })
        if (cancelled) await unsubscribe()
        else setOnline(true)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    void connect()
    return () => {
      cancelled = true
      void unsubscribe?.()
    }
  }, [onUnauthorized])

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (creating || title.trim().length < 3) return
    setCreating(true)
    try {
      const state = await requestJson<AppState>('/rooms', { method: 'POST', body: { title } })
      window.location.href = facilitatorPath(state.room.slug)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setMessage(error instanceof Error ? error.message : 'Não foi possível criar a sala.')
      setCreating(false)
    }
  }

  const rooms = lobby?.rooms ?? []

  return (
    <div className="app-shell lobby-shell">
      <Header online={online} identity={identity} onLogout={onLogout} />
      <main className="lobby-main">
        <section className="lobby-hero panel-enter">
          <div className="lobby-intro">
            <span className="kicker">salas abertas · comunidade PHP</span>
            <h1>Toda boa conversa começa com uma pergunta.</h1>
            <p>Crie uma sala para o próximo encontro ou entre numa conversa que já está na água.</p>
          </div>
          <form className="room-create panel" onSubmit={create}>
            <div className="room-create-icon" aria-hidden="true">+</div>
            <span className="kicker">nova sala</span>
            <h2>Dê um nome para a sala.</h2>
            <label htmlFor="room-title">Nome da sala</label>
            <input id="room-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="ex.: PHPinga de setembro" maxLength={80} />
            <button className="button button-coral" type="submit" disabled={title.trim().length < 3 || creating}>{creating ? 'Criando…' : 'Criar e facilitar'}</button>
            <small>Um link único será criado para compartilhar com o grupo.</small>
          </form>
        </section>
        <section className="rooms-section">
          <div className="rooms-heading"><div><span className="kicker">o cais</span><h2>Salas abertas</h2></div><span>{rooms.length} {rooms.length === 1 ? 'sala' : 'salas'}</span></div>
          {rooms.length === 0 ? (
            <div className="rooms-empty panel"><span className="empty-fin" aria-hidden="true">◒</span><div><strong>Nenhuma sala por aqui ainda.</strong><p>Crie a primeira sala acima. Ela começa vazia, pronta para receber pessoas e perguntas reais.</p></div></div>
          ) : (
            <div className="room-board panel">
              {rooms.map((room) => <RoomRow room={room} key={room.id} />)}
            </div>
          )}
        </section>
      </main>
      {message && <Notice message={message} onDismiss={() => setMessage('')} />}
    </div>
  )
}

function RoomRow({ room }: { room: RoomSummary }) {
  return (
    <article className="room-row">
      <div className={`room-status phase-${room.phase}`}><span /></div>
      <div className="room-summary"><h3>{room.title}</h3><span>{room.slug}</span></div>
      <div className="room-stats"><span><strong>{room.participantCount}</strong> pessoas</span><span><strong>{room.questionCount}</strong> perguntas</span></div>
      <div className="room-actions"><a className="button button-primary" href={roomPath(room.slug)}>Entrar</a></div>
    </article>
  )
}

function QuestionComposer({ onSubmit }: { onSubmit: (text: string, anonymous: boolean) => Promise<void> }) {
  const [text, setText] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(text, anonymous)
      setText('')
      setAnonymous(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="question-composer panel" onSubmit={submit}>
      <div className="composer-heading"><div><span className="kicker">sua vez</span><h2>Jogue uma pergunta na água.</h2></div><span className="composer-icon" aria-hidden="true">↗</span></div>
      <label className="sr-only" htmlFor="question-text">Escreva sua pergunta</label>
      <textarea id="question-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="O que está passando pela sua cabeça?" maxLength={280} rows={4} />
      <div className="composer-footer">
        <label className="check-label"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span className="fake-check" aria-hidden="true">✓</span>Enviar como anônimo</label>
        <div className="composer-submit"><span className="character-count">{text.length}/280</span><button className="button button-coral" type="submit" disabled={!text.trim() || submitting}>{submitting ? 'Enviando…' : 'Enviar pergunta'}</button></div>
      </div>
    </form>
  )
}

function ActiveQuestionCard({ question, queue, participantId, onJoin }: { question: Question | undefined; queue: QueueEntry[]; participantId: string; onJoin: (replyToEntryId: string | null) => Promise<void> }) {
  const [replyMode, setReplyMode] = useState(false)
  const [replyTo, setReplyTo] = useState('')
  const [joining, setJoining] = useState(false)
  const availableTargets = queue.filter((entry) => entry.status === 'finished' || entry.status === 'speaking')
  const alreadyInQueue = queue.some((entry) => entry.participantId === participantId && (entry.status === 'waiting' || entry.status === 'speaking'))

  if (!question) {
    return <section className="empty-stage panel"><div className="empty-wave" aria-hidden="true"><span /><span /><span /></div><span className="kicker">a próxima onda</span><h2>O facilitador ainda não abriu uma pergunta.</h2><p>Enquanto isso, deixe a sua no tanque. Ela aparece no painel assim que chegar.</p></section>
  }

  const join = async () => {
    setJoining(true)
    try {
      await onJoin(replyMode ? replyTo || null : null)
      setReplyMode(false)
      setReplyTo('')
    } finally {
      setJoining(false)
    }
  }

  return (
    <section className="active-question panel">
      <div className="active-question-top"><span className="live-label"><span /> pergunta na água</span><span className="queue-count">{queue.filter((entry) => entry.status === 'waiting').length} na fila</span></div>
      <blockquote>“{question.text}”</blockquote>
      <div className="question-byline"><span className="avatar avatar-small">{question.anonymous ? '?' : getInitials(question.authorName)}</span><span>Pergunta de <strong>{question.anonymous ? 'Anônimo' : question.authorName}</strong></span></div>
      <div className="join-area">
        {alreadyInQueue ? <div className="joined-state"><span className="check-badge">✓</span><div><strong>Você está na fila.</strong><span>Aguarde sua vez; a ordem é igual para todos.</span></div></div> : <><div className="join-row"><button className="button button-primary join-button" type="button" onClick={join} disabled={joining}>{joining ? 'Entrando…' : 'Quero falar'}</button><button className={`button button-quiet ${replyMode ? 'is-selected' : ''}`} type="button" onClick={() => setReplyMode(!replyMode)} aria-pressed={replyMode}>É uma réplica</button></div>{replyMode && <div className="reply-select-wrap panel-enter"><label htmlFor="reply-to">Réplica para</label><select id="reply-to" value={replyTo} onChange={(event) => setReplyTo(event.target.value)}><option value="">Escolha alguém (opcional)</option>{availableTargets.map((entry) => <option value={entry.id} key={entry.id}>{entry.participantName}</option>)}</select><small>Ela entra no fim da fila, com o mesmo tempo.</small></div>}</>}
      </div>
    </section>
  )
}

function ParticipantView({ state, online, identity, publicOrigin, onLogout, onAction, onMessage }: { state: AppState; online: boolean; identity: Identity; publicOrigin: string | null | undefined; onLogout: () => void; onAction: (action: Action) => Promise<void>; onMessage: (message: string) => void }) {
  const activeQuestion = state.questions.find((question) => question.id === state.session.activeQuestionId)
  const activeQueue = activeQuestion ? state.queue.filter((entry) => entry.questionId === activeQuestion.id) : []
  const myQuestions = state.questions.filter((question) => !question.anonymous && question.authorName === identity.name).slice(-3).reverse()

  const submitQuestion = async (text: string, anonymous: boolean) => {
    await onAction({ type: 'submit-question', text, anonymous })
    onMessage('Pergunta lançada. O facilitador já consegue vê-la.')
  }

  return (
    <div className="app-shell participant-shell">
      <Header online={online} identity={identity} onLogout={onLogout} room={state.room} publicOrigin={publicOrigin} canFacilitate={state.permissions.canFacilitate} />
      <main className="participant-main">
        <section className="welcome-row panel-enter"><div><span className="kicker">{state.room.title}</span><h1>Oi, <span>{identity.name}</span>.</h1><p>A sala está aberta. Pergunte, escute, entre na conversa.</p></div><a className="back-to-lobby" href="/">ver todas as salas</a></section>
        <QuestionComposer onSubmit={submitQuestion} />
        <ActiveQuestionCard question={activeQuestion} queue={activeQueue} participantId={identity.id} onJoin={(replyToEntryId) => onAction({ type: 'join-queue', replyToEntryId })} />
        {myQuestions.length > 0 && <section className="my-questions panel-enter"><div className="section-heading"><div><span className="kicker">seu rastro</span><h2>Perguntas enviadas</h2></div><span>{myQuestions.length}</span></div><div className="my-question-list">{myQuestions.map((question) => <div className="my-question" key={question.id}><span className={`status-dot status-${question.status}`} /><p>{question.text}</p><span className="question-status">{question.status === 'waiting' ? 'na fila' : question.status === 'active' ? 'em pauta' : 'encerrada'}</span></div>)}</div></section>}
      </main>
      <footer className="site-footer"><span>Shark Bowl para a PHPinda</span><span>{state.room.title}</span></footer>
    </div>
  )
}

function Timer({ startedAt, durationSeconds }: { startedAt: number | null; durationSeconds: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const remaining = Math.max(0, durationSeconds - elapsed)
  const overtime = Math.max(0, elapsed - durationSeconds)
  const progress = Math.min(100, (elapsed / durationSeconds) * 100)
  const style = { '--timer-progress': `${progress}%` } as CSSProperties
  return <div className={`timer ${overtime > 0 ? 'is-overtime' : ''}`} style={style} aria-label={startedAt ? `Tempo restante ${formatClock(remaining)}` : 'Cronômetro parado'}><span className="timer-ring" aria-hidden="true" /><span className="timer-label">{overtime > 0 ? 'passou' : startedAt ? 'resta' : 'pronto'}</span><strong>{overtime > 0 ? `+${formatClock(overtime)}` : formatClock(remaining)}</strong><small>{durationSeconds / 60} min por fala</small></div>
}

function QueueRow({ entry, index, active }: { entry: QueueEntry; index: number; active?: boolean }) {
  return <div className={`queue-row ${active ? 'is-speaking' : ''}`}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><span className="avatar avatar-small">{getInitials(entry.participantName)}</span><div className="queue-person"><strong>{entry.participantName}</strong>{entry.replyToName && <span>↳ réplica para {entry.replyToName}</span>}</div>{active ? <span className="speaking-pill">falando</span> : <span className={`entry-state state-${entry.status}`}>{entry.status === 'finished' ? 'falou' : 'aguardando'}</span>}</div>
}

function FacilitatorAccess({ state, onAction }: { state: AppState; onAction: (action: Action) => Promise<void> }) {
  const [busyUserId, setBusyUserId] = useState('')
  const facilitatorIds = new Set(state.facilitators.map((facilitator) => facilitator.id))

  const setFacilitator = async (userId: string, enabled: boolean) => {
    setBusyUserId(userId)
    try {
      await onAction({ type: 'set-facilitator', userId, enabled })
    } finally {
      setBusyUserId('')
    }
  }

  return (
    <section className="facilitator-access panel">
      <div className="facilitator-access-heading"><div><span className="kicker">quem conduz</span><h2>Facilitadores</h2><p>Quem já entrou na sala pode ajudar a conduzir a conversa.</p></div><span>{state.facilitators.length} convidados</span></div>
      <div className="facilitator-access-list">
        {state.participants.map((participant) => {
          const isOwner = participant.id === state.room.ownerId
          const isFacilitator = isOwner || facilitatorIds.has(participant.id)
          return <div className="facilitator-access-row" key={participant.id}><span className="avatar avatar-small">{getInitials(participant.name)}</span><strong>{participant.name}</strong>{isOwner ? <span className="access-role">dono</span> : <button className="button button-quiet" type="button" disabled={busyUserId === participant.id} onClick={() => void setFacilitator(participant.id, !isFacilitator)}>{busyUserId === participant.id ? 'Salvando…' : isFacilitator ? 'Remover acesso' : 'Tornar facilitador'}</button>}</div>
        })}
      </div>
    </section>
  )
}

function FacilitatorView({ state, online, identity, publicOrigin, onLogout, onAction, onMessage }: { state: AppState; online: boolean; identity: Identity; publicOrigin: string | null | undefined; onLogout: () => void; onAction: (action: Action) => Promise<void>; onMessage: (message: string) => void }) {
  const activeQuestion = state.questions.find((question) => question.id === state.session.activeQuestionId)
  const activeEntry = state.queue.find((entry) => entry.id === state.session.activeEntryId)
  const activeQueue = activeQuestion ? state.queue.filter((entry) => entry.questionId === activeQuestion.id).sort((a, b) => a.createdAt - b.createdAt) : []
  const waitingQuestions = state.questions.filter((question) => question.status === 'waiting').sort((a, b) => a.createdAt - b.createdAt)
  const waitingEntries = activeQueue.filter((entry) => entry.status === 'waiting')
  const completedEntries = activeQueue.filter((entry) => entry.status === 'finished')

  const action = async (nextAction: Action, successMessage?: string) => {
    await onAction(nextAction)
    if (successMessage) onMessage(successMessage)
  }

  return (
    <div className="app-shell facilitator-shell">
      <Header online={online} identity={identity} onLogout={onLogout} room={state.room} publicOrigin={publicOrigin} facilitator />
      <main className="facilitator-main">
        <section className="facilitator-heading panel-enter"><div><span className="kicker">sala de controle · {state.room.title}</span><h1>A conversa está na sua mão.</h1><p>Escolha a pergunta, mantenha o ritmo e deixe a fila respirar.</p></div><div className="facilitator-meta"><span className="room-chip"><span className="room-pulse" /> sala ao vivo</span><span>{state.participants.length} {state.participants.length === 1 ? 'participante' : 'participantes'} na sessão</span></div></section>
        <section className="share-strip panel"><div className="share-strip-mark" aria-hidden="true"><span /><span /><span /><span /></div><div><span className="kicker">convide para a sala</span><h2>Abra a câmera. Entre na conversa.</h2><p>Mostre o QR no telão ou copie o link público desta sala.</p></div><RoomShare room={state.room} publicOrigin={publicOrigin} prominent /></section>
        <div className="facilitator-grid">
          <section className="control-stage panel"><div className="stage-header"><span className="kicker">agora</span><span className={`phase-chip phase-${state.session.phase}`}>{state.session.phase === 'running' ? 'em andamento' : 'aguardando'}</span></div>{activeQuestion ? <><div className="active-prompt"><span className="prompt-mark">“</span><p>{activeQuestion.text}</p><div className="question-byline"><span className="avatar avatar-small">{activeQuestion.anonymous ? '?' : getInitials(activeQuestion.authorName)}</span><span>{activeQuestion.anonymous ? 'Anônimo' : activeQuestion.authorName}</span></div></div><div className="stage-live-row"><Timer startedAt={state.session.speechStartedAt} durationSeconds={state.session.durationSeconds} /><div className="speaker-now"><span className="kicker">no microfone</span>{activeEntry ? <><strong>{activeEntry.participantName}</strong>{activeEntry.replyToName && <span>Réplica para {activeEntry.replyToName}</span>}</> : <strong className="muted-text">Ninguém ainda</strong>}</div></div><div className="stage-actions">{activeEntry ? <button className="button button-coral action-button" type="button" onClick={() => action({ type: 'finish-current' }, waitingEntries.length > 0 ? 'Fala passada. Cronômetro reiniciado.' : 'Fala encerrada. A fila continua aberta.')}>Passar para próxima fala <span>↗</span></button> : <button className="button button-primary action-button" type="button" onClick={() => action({ type: 'start-next' })} disabled={waitingEntries.length === 0}>Iniciar próxima fala <span>↗</span></button>}<button className="button button-quiet" type="button" onClick={() => action({ type: 'close-question' }, 'Pergunta encerrada. A sala está pronta para outra.')}>Encerrar pergunta</button></div>{waitingEntries.length === 0 && <div className="open-queue-note"><span>⌁</span><div><strong>Fila aberta</strong><span>Ninguém na fila agora. Novas inscrições não encerram esta pergunta.</span></div></div>}</> : <div className="control-empty"><div className="empty-buoy">◒</div><h2>Escolha uma pergunta para começar.</h2><p>As perguntas que chegam aparecem logo abaixo. A fila só abre depois que você selecionar uma.</p></div>}</section>
          <section className="queue-panel panel"><div className="queue-panel-header"><div><span className="kicker">ordem da palavra</span><h2>Fila de fala</h2></div><span className="queue-total">{waitingEntries.length} <small>aguardando</small></span></div><div className="queue-list">{activeEntry && <QueueRow entry={activeEntry} index={0} active />}{waitingEntries.map((entry, index) => <QueueRow entry={entry} index={index + (activeEntry ? 1 : 0)} key={entry.id} />)}{!activeEntry && waitingEntries.length === 0 && <div className="queue-empty"><span>⌁</span><p>A fila está tranquila.<br /><small>O próximo mergulho entra pelo celular.</small></p></div>}</div>{completedEntries.length > 0 && <div className="completed-queue"><span className="kicker">já falaram · {completedEntries.length}</span>{completedEntries.slice(-3).map((entry) => <div className="completed-row" key={entry.id}><span className="check-badge">✓</span><span>{entry.participantName}</span>{entry.replyToName && <small>réplica</small>}</div>)}</div>}</section>
        </div>
        <section className="question-inbox panel"><div className="inbox-header"><div><span className="kicker">o tanque</span><h2>Perguntas recebidas</h2></div><span className="inbox-count">{waitingQuestions.length} novas</span></div>{waitingQuestions.length === 0 ? <div className="inbox-empty"><span>◌</span><div><strong>Nenhuma pergunta aguardando.</strong><p>Quando alguém enviar, ela aparece aqui para você escolher a próxima onda.</p></div></div> : <div className="question-grid">{waitingQuestions.map((question) => <article className="question-card" key={question.id}><div className="question-card-top"><span className="question-time">{formatRelativeTime(question.createdAt)}</span><span className="question-author"><span className="avatar avatar-tiny">{question.anonymous ? '?' : getInitials(question.authorName)}</span>{question.anonymous ? 'Anônimo' : question.authorName}</span></div><p>{question.text}</p><button className="button button-primary button-full" type="button" onClick={() => action({ type: 'select-question', questionId: question.id }, 'Pergunta aberta. A fila está liberada.')}>Abrir esta pergunta</button></article>)}</div>}</section>
        <section className="facilitator-settings panel"><div><span className="kicker">ritmo da sala</span><h2>Tempo por fala</h2><p>O cronômetro é um guia visual; a passagem é sempre manual.</p></div><div className="duration-toggle" role="group" aria-label="Tempo por fala">{[120, 180].map((duration) => <button type="button" key={duration} className={state.session.durationSeconds === duration ? 'is-active' : ''} onClick={() => action({ type: 'set-duration', durationSeconds: duration as 120 | 180 })}>{duration / 60} min</button>)}</div></section>
        {state.permissions.canManageFacilitators && <FacilitatorAccess state={state} onAction={onAction} />}
        {state.permissions.canManageFacilitators && <section className="session-reset panel"><div><span className="kicker">recomeçar</span><h2>Limpar a conversa</h2><p>Apaga perguntas e falas, mas mantém a sala e os facilitadores.</p></div><button className="button button-quiet" type="button" onClick={() => void action({ type: 'reset-session' }, 'A conversa foi reiniciada.')}>Reiniciar sessão</button></section>}
      </main>
    </div>
  )
}

function RoomView({ roomId, facilitator, identity, onLogout, onUnauthorized }: { roomId: string; facilitator: boolean; identity: Identity; onLogout: () => void; onUnauthorized: () => void }) {
  const [state, setState] = useState<AppState | null>(null)
  const [online, setOnline] = useState(false)
  const [message, setMessage] = useState('')
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => Promise<void>) | undefined
    let roomRecordId = ''
    const load = async (join = false) => {
      try {
        const nextState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/state`)
        if (join) {
          const joinedState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' })
          roomRecordId = joinedState.room.id
          if (!cancelled) setState(joinedState)
          return joinedState
        }
        roomRecordId = nextState.room.id
        if (!cancelled) setState(nextState)
        return nextState
      } catch (error) {
        if (!cancelled && error instanceof ApiError && error.status === 401) onUnauthorized()
        else if (error instanceof ApiError && error.status === 404) {
          if (!cancelled) setMissing(true)
        } else if (!cancelled) setMessage(error instanceof Error ? error.message : 'Não foi possível abrir a sala.')
        return null
      }
    }
    const connect = async () => {
      const initial = await load(true)
      if (cancelled || !initial || !roomRecordId) return
      try {
        unsubscribe = await pocketbase.collection('rooms').subscribe(roomRecordId, () => { void load() })
        if (cancelled) await unsubscribe()
        else setOnline(true)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    void connect()
    return () => {
      cancelled = true
      void unsubscribe?.()
    }
  }, [onUnauthorized, roomId])

  const onAction = async (action: Action) => {
    try {
      const nextState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/actions`, { method: 'POST', body: action })
      setState(nextState)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      const nextMessage = error instanceof Error ? error.message : 'Não foi possível atualizar a sala.'
      setMessage(nextMessage)
      throw error
    }
  }

  if (missing) return <div className="not-found"><Brand /><span className="empty-fin">◒</span><h1>Essa sala saiu do radar.</h1><p>Confira o link ou volte para o lobby.</p><a className="button button-primary" href="/">Ver salas abertas</a></div>
  if (!state) return <div className="loading-screen"><span className="loading-fin">◒</span><p>abrindo a sala…</p></div>
  if (facilitator && !state.permissions.canFacilitate) return <div className="not-found"><Brand /><span className="empty-fin">◒</span><h1>Essa sala está em boas mãos.</h1><p>Somente o dono ou facilitadores indicados podem abrir o painel de controle.</p><a className="button button-primary" href={roomPath(state.room.slug)}>Participar da sala</a></div>
  return <>{facilitator ? <FacilitatorView state={state} online={online} identity={identity} publicOrigin={publicAppOrigin} onLogout={onLogout} onAction={onAction} onMessage={setMessage} /> : <ParticipantView state={state} online={online} identity={identity} publicOrigin={publicAppOrigin} onLogout={onLogout} onAction={onAction} onMessage={setMessage} />}{message && <Notice message={message} onDismiss={() => setMessage('')} />}</>
}

function AuthenticatedApp({ identity, onLogout, onUnauthorized }: { identity: Identity; onLogout: () => void; onUnauthorized: () => void }) {
  const route = useMemo(() => {
    const match = window.location.pathname.match(/^\/s\/([^/]+)(?:\/(facilitador))?\/?$/)
    if (!match) return { kind: 'lobby' as const }
    return { kind: 'room' as const, roomId: decodeURIComponent(match[1]), facilitator: match[2] === 'facilitador' }
  }, [])
  if (route.kind === 'lobby') return <LobbyView identity={identity} onLogout={onLogout} onUnauthorized={onUnauthorized} />
  return <RoomView roomId={route.roomId} facilitator={route.facilitator} identity={identity} onLogout={onLogout} onUnauthorized={onUnauthorized} />
}

function App() {
  const [theme, setTheme] = useState<Theme>(getPreferredTheme)
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [resolving, setResolving] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      try {
        if (!pocketbase.authStore.isValid) return
        const refreshed = await pocketbase.collection('users').authRefresh()
        if (!cancelled) setIdentity(toIdentity(refreshed.record))
      } catch (caught) {
        pocketbase.authStore.clear()
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Não foi possível restaurar sua sessão.')
      } finally {
        if (!cancelled) setResolving(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [])

  const login = () => {
    setError('')
    return pocketbase.collection('users').authWithOAuth2({ provider: 'github' })
      .then((result) => setIdentity(toIdentity(result.record)))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Não foi possível entrar com GitHub.'))
  }

  const logout = () => {
    pocketbase.authStore.clear()
    pocketbase.cancelAllRequests()
    void pocketbase.realtime.unsubscribe()
    setError('')
    setIdentity(null)
  }

  const expire = () => {
    pocketbase.authStore.clear()
    pocketbase.cancelAllRequests()
    void pocketbase.realtime.unsubscribe()
    setError('')
    setIdentity(null)
  }

  const content = resolving
    ? <div className="loading-screen"><span className="loading-fin">◒</span><p>restaurando sua sessão…</p></div>
    : !identity
      ? <IdentityGate error={error} onLogin={login} />
      : <AuthenticatedApp identity={identity} onLogout={logout} onUnauthorized={expire} />

  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }}>{content}</ThemeContext.Provider>
}

export default App
