import { QRCodeSVG } from 'qrcode.react'
import phpComRapaduraLogo from './assets/php-com-rapadura.png'
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
  const [joining, setJoining] = useState(false)
  const availableTargets = queue.filter((entry) => entry.speechNumber && (entry.status === 'finished' || entry.status === 'speaking')).sort((left, right) => (right.speechNumber || 0) - (left.speechNumber || 0))
  const ownRequest = queue.find((entry) => entry.participantId === participantId && (entry.status === 'waiting' || entry.status === 'speaking'))

  if (!question) return <section className="empty-stage panel"><div className="empty-wave" aria-hidden="true"><span /><span /><span /></div><span className="kicker">a próxima onda</span><h2>O facilitador ainda não abriu uma pergunta.</h2><p>Enquanto isso, deixe a sua no tanque. Ela aparece no painel assim que chegar.</p></section>

  const join = async (replyToEntryId: string | null) => {
    if (joining || ownRequest) return
    setJoining(true)
    try {
      await onJoin(replyToEntryId)
    } catch {} finally {
      setJoining(false)
    }
  }

  return <section className="active-question panel">
    <div className="active-question-top"><span className="live-label"><span /> pergunta na água</span><span className="queue-count">{queue.filter((entry) => entry.status === 'waiting').length} na fila</span></div>
    <blockquote>“{question.text}”</blockquote>
    <div className="question-byline"><span className="avatar avatar-small">{question.anonymous ? '?' : getInitials(question.authorName)}</span><span>Pergunta de <strong>{question.authorName}</strong></span></div>
    <div className="join-area">{ownRequest ? <div className="joined-state"><span className="check-badge">✓</span><div><strong>{ownRequest.status === 'speaking' ? 'Você está com a palavra.' : 'Seu pedido está na fila.'}</strong>{ownRequest.replyToName && <span>Resposta à fala #{ownRequest.replyToSpeechNumber} de {ownRequest.replyToName}.</span>}<span>O dono pode antecipar réplicas para conduzir a conversa.</span></div></div> : <button className="button button-primary join-button" type="button" onClick={() => void join(null)} disabled={joining}>{joining ? 'Registrando…' : 'Quero falar'}</button>}</div>
    {availableTargets.length > 0 && <div className="speech-history"><h3>Falas desta pergunta</h3><p>Responda a uma intervenção específica. A réplica entra no fim da fila; o dono pode antecipá-la.</p>{availableTargets.map((entry) => <div className="speech-history-row" key={entry.id}><div><strong>{entry.participantName}</strong><span>Fala #{entry.speechNumber} · {entry.status === 'speaking' ? 'com a palavra agora' : 'concluída'}</span></div><button className="button button-quiet" type="button" disabled={joining || Boolean(ownRequest)} onClick={() => void join(entry.id)} aria-label={`Responder à fala ${entry.speechNumber} de ${entry.participantName}`}>Responder a esta fala</button></div>)}</div>}
  </section>
}

const compareQuestionVotes = (left: Question, right: Question) => right.voteCount - left.voteCount || left.createdAt - right.createdAt || left.id.localeCompare(right.id)

function QuestionVote({ question, onAction }: { question: Question; onAction: (action: Action) => Promise<void> }) {
  const [voting, setVoting] = useState(false)
  const vote = async () => {
    if (voting) return
    setVoting(true)
    try {
      await onAction({ type: 'set-vote', questionId: question.id, enabled: !question.votedByMe })
    } finally {
      setVoting(false)
    }
  }
  return <button className={`question-vote ${question.votedByMe ? 'is-voted' : ''}`} type="button" aria-pressed={question.votedByMe} aria-label={`${question.votedByMe ? 'Remover curtida' : 'Curtir pergunta'}: ${question.text}. ${question.voteCount} curtidas`} disabled={voting} onClick={() => void vote()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg><strong>{question.voteCount}</strong></button>
}

function ParticipantView({ state, online, identity, publicOrigin, onLogout, onAction, onMessage }: { state: AppState; online: boolean; identity: Identity; publicOrigin: string | null | undefined; onLogout: () => void; onAction: (action: Action) => Promise<void>; onMessage: (message: string) => void }) {
  const activeQuestion = state.questions.find((question) => question.id === state.session.activeQuestionId)
  const activeQueue = activeQuestion ? state.queue.filter((entry) => entry.questionId === activeQuestion.id) : []
  const pendingQuestions = state.questions.filter((question) => question.status === 'waiting').sort(compareQuestionVotes)
  const myQuestions = state.questions.filter((question) => !question.anonymous && question.authorName === identity.name).slice(-3).reverse()

  const submitQuestion = async (text: string, anonymous: boolean) => {
    await onAction({ type: 'submit-question', text, anonymous })
    onMessage('Pergunta lançada. O facilitador já consegue vê-la.')
  }

  return (
    <div className="app-shell participant-shell">
      <Header online={online} identity={identity} onLogout={onLogout} room={state.room} publicOrigin={publicOrigin} canFacilitate={state.permissions.canFacilitate} />
      <main className="participant-main">
        <section className="welcome-row panel-enter"><div><h1 className="room-title">{state.room.title}</h1><p className="room-subtitle">Oi, <span>{identity.name}</span>.</p><p>A sala está aberta. Pergunte, escute, entre na conversa.</p></div><a className="back-to-lobby" href="/">ver todas as salas</a></section>
        <QuestionComposer onSubmit={submitQuestion} />
        <ActiveQuestionCard question={activeQuestion} queue={activeQueue} participantId={identity.id} onJoin={(replyToEntryId) => onAction({ type: 'join-queue', replyToEntryId, isReply: Boolean(replyToEntryId) })} />
        <section className="pending-questions panel"><div className="section-heading"><div><span className="kicker">escolha da comunidade</span><h2>Perguntas aguardando</h2></div><span>{pendingQuestions.length}</span></div><p className="voting-help">Vote nas perguntas que gostaria de ouvir. O dono decide qual abrir.</p>{pendingQuestions.length ? <div className="question-grid">{pendingQuestions.map((question) => <article className="question-card" key={question.id}><div className="question-card-top"><span className="question-time">{formatRelativeTime(question.createdAt)}</span><span className="question-author">{question.authorName}</span></div><p>{question.text}</p><QuestionVote question={question} onAction={onAction} /></article>)}</div> : <p className="voting-help">Nenhuma pergunta aguardando. Envie a primeira.</p>}</section>
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

function QueueRow({ entry, index, active, onPrioritize }: { entry: QueueEntry; index: number; active?: boolean; onPrioritize?: () => void }) {
  return <div className={`queue-row ${active ? 'is-speaking' : ''}`}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><span className="avatar avatar-small">{getInitials(entry.participantName)}</span><div className="queue-person"><strong>{entry.participantName}</strong>{entry.replyToName && <span>↳ resposta à fala #{entry.replyToSpeechNumber} de {entry.replyToName}</span>}</div>{onPrioritize && <button className="button button-quiet prioritize-reply" type="button" onClick={onPrioritize}>Colocar como próxima</button>}{active ? <span className="speaking-pill">falando</span> : <span className={`entry-state state-${entry.status}`}>{entry.status === 'finished' ? 'falou' : 'aguardando'}</span>}</div>
}

function RoomTransfer({ state, onAction }: { state: AppState; onAction: (action: Action) => Promise<void> }) {
  const [recipientId, setRecipientId] = useState('')
  const [transferring, setTransferring] = useState(false)
  const recipients = state.participants.filter((participant) => participant.id !== state.room.ownerId)
  const recipient = recipients.find((participant) => participant.id === recipientId)
  const transfer = async () => {
    if (!recipient || transferring || !window.confirm(`Transferir “${state.room.title}” para ${recipient.name}? Você perderá imediatamente o controle e continuará como participante. Somente o novo dono poderá transferir a sala de volta.`)) return
    setTransferring(true)
    try {
      await onAction({ type: 'transfer-ownership', userId: recipient.id })
    } catch {
      setTransferring(false)
    }
  }
  return <section className="session-reset panel"><div><span className="kicker">trocar quem conduz</span><h2>Transferir sala</h2><p>A sala mantém perguntas, votos e fila. Você perde o controle; a pessoa escolhida será o único dono.</p></div><div className="duration-choice"><label htmlFor="room-recipient">Novo dono</label><select id="room-recipient" value={recipientId} onChange={(event) => setRecipientId(event.target.value)} disabled={transferring}><option value="">Escolha um participante</option>{recipients.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}</select>{recipients.length === 0 && <small>Outra pessoa precisa entrar na sala para recebê-la.</small>}<button className="button button-quiet" type="button" disabled={!recipient || transferring} onClick={() => void transfer()}>{transferring ? 'Transferindo…' : 'Transferir sala'}</button></div></section>
}

function FacilitatorView({ state, online, identity, publicOrigin, onLogout, onAction, onMessage }: { state: AppState; online: boolean; identity: Identity; publicOrigin: string | null | undefined; onLogout: () => void; onAction: (action: Action) => Promise<void>; onMessage: (message: string) => void }) {
  const [durationMinutes, setDurationMinutes] = useState(String(state.session.durationSeconds / 60))
  const selectedDuration = Number(durationMinutes) * 60
  const durationValid = durationMinutes.trim() !== '' && Number.isSafeInteger(selectedDuration) && selectedDuration >= 1 && selectedDuration <= 86400
  const activeQuestion = state.questions.find((question) => question.id === state.session.activeQuestionId)
  const activeEntry = state.queue.find((entry) => entry.id === state.session.activeEntryId)
  const activeQueue = activeQuestion ? state.queue.filter((entry) => entry.questionId === activeQuestion.id).sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id)) : []
  const waitingQuestions = state.questions.filter((question) => question.status === 'waiting').sort(compareQuestionVotes)
  const waitingEntries = activeQueue.filter((entry) => entry.status === 'waiting')
  const completedEntries = activeQueue.filter((entry) => entry.status === 'finished' && entry.speechNumber).sort((a, b) => (a.speechNumber || 0) - (b.speechNumber || 0))

  const action = async (nextAction: Action, successMessage?: string) => {
    await onAction(nextAction)
    if (successMessage) onMessage(successMessage)
  }

  return (
    <div className="app-shell facilitator-shell">
      <Header online={online} identity={identity} onLogout={onLogout} room={state.room} publicOrigin={publicOrigin} facilitator />
      <main className="facilitator-main">
        <section className="facilitator-heading panel-enter"><div><span className="kicker">sala de controle</span><h1 className="room-title">{state.room.title}</h1><p className="room-subtitle">A conversa está na sua mão.</p><p>Escolha a pergunta, mantenha o ritmo e deixe a fila respirar.</p></div><div className="facilitator-meta"><span className="room-chip"><span className="room-pulse" /> sala ao vivo</span><span>{state.participants.length} {state.participants.length === 1 ? 'participante' : 'participantes'} na sessão</span></div></section>
        <section className="share-strip panel"><div className="share-strip-mark" aria-hidden="true"><span /><span /><span /><span /></div><div><span className="kicker">convide para a sala</span><h2>Abra a câmera. Entre na conversa.</h2><p>Mostre o QR no telão ou copie o link público desta sala.</p></div><RoomShare room={state.room} publicOrigin={publicOrigin} prominent /></section>
        <div className="facilitator-grid">
          <section className="control-stage panel"><div className="stage-header"><span className="kicker">agora</span><span className={`phase-chip phase-${state.session.phase}`}>{state.session.phase === 'running' ? 'em andamento' : 'aguardando'}</span></div>{activeQuestion ? <><div className="active-prompt"><span className="prompt-mark">“</span><p>{activeQuestion.text}</p><div className="question-byline"><span className="avatar avatar-small">{activeQuestion.anonymous ? '?' : getInitials(activeQuestion.authorName)}</span><span>{activeQuestion.anonymous ? 'Anônimo' : activeQuestion.authorName}</span></div></div><div className="stage-live-row"><Timer startedAt={state.session.speechStartedAt} durationSeconds={state.session.durationSeconds} /><div className="speaker-now"><span className="kicker">no microfone</span>{activeEntry ? <><strong>{activeEntry.participantName}</strong>{activeEntry.replyToName && <span>Resposta à fala #{activeEntry.replyToSpeechNumber} de {activeEntry.replyToName}</span>}</> : <strong className="muted-text">Ninguém ainda</strong>}</div></div><div className="stage-actions">{activeEntry ? <button className="button button-coral action-button" type="button" onClick={() => action({ type: 'finish-current' }, waitingEntries.length > 0 ? 'Fala passada. Cronômetro reiniciado.' : 'Fala encerrada. A fila continua aberta.')}>Passar para próxima fala <span>↗</span></button> : <button className="button button-primary action-button" type="button" onClick={() => action({ type: 'start-next' })} disabled={waitingEntries.length === 0}>Iniciar próxima fala <span>↗</span></button>}<button className="button button-quiet" type="button" onClick={() => action({ type: 'close-question' }, 'Pergunta encerrada. A sala está pronta para outra.')}>Encerrar pergunta</button></div>{waitingEntries.length === 0 && <div className="open-queue-note"><span>⌁</span><div><strong>Fila aberta</strong><span>Ninguém na fila agora. Novas inscrições não encerram esta pergunta.</span></div></div>}</> : <div className="control-empty"><div className="empty-buoy">◒</div><h2>Escolha uma pergunta para começar.</h2><p>As perguntas que chegam aparecem logo abaixo. A fila só abre depois que você selecionar uma.</p></div>}</section>
          <section className="queue-panel panel"><div className="queue-panel-header"><div><span className="kicker">ordem da palavra</span><h2>Fila de fala</h2></div><span className="queue-total">{waitingEntries.length} <small>aguardando</small></span></div><div className="queue-list">{activeEntry && <QueueRow entry={activeEntry} index={0} active />}{waitingEntries.map((entry, index) => <QueueRow entry={entry} index={index + (activeEntry ? 1 : 0)} key={entry.id} onPrioritize={entry.replyToEntryId && index > 0 ? () => void action({ type: 'prioritize-reply', entryId: entry.id }, 'Réplica definida como próxima fala.') : undefined} />)}{!activeEntry && waitingEntries.length === 0 && <div className="queue-empty"><span>⌁</span><p>A fila está tranquila.<br /><small>O próximo mergulho entra pelo celular.</small></p></div>}</div>{completedEntries.length > 0 && <div className="completed-queue"><span className="kicker">já falaram · {completedEntries.length}</span>{completedEntries.slice(-3).map((entry) => <div className="completed-row" key={entry.id}><span className="check-badge">✓</span><span>Fala #{entry.speechNumber} · {entry.participantName}</span>{entry.replyToName && <small>resposta à fala #{entry.replyToSpeechNumber}</small>}</div>)}</div>}</section>
        </div>
        <section className="facilitator-settings panel"><div><span className="kicker">próxima pergunta</span><h2>Tempo por fala</h2><p>Aplicado ao abrir uma pergunta. A passagem de fala continua manual.</p></div><div className="duration-choice"><div className="duration-toggle" role="group" aria-label="Tempos sugeridos">{[2, 3, 5].map((minutes) => <button type="button" key={minutes} aria-pressed={Number(durationMinutes) === minutes} className={Number(durationMinutes) === minutes ? 'is-active' : ''} onClick={() => setDurationMinutes(String(minutes))}>{minutes} min</button>)}</div><label htmlFor="speech-minutes">Personalizado (minutos)</label><input id="speech-minutes" type="number" inputMode="decimal" min={1 / 60} max="1440" step="any" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} aria-invalid={!durationValid} aria-describedby="speech-duration-help" /><small id="speech-duration-help">{durationValid ? 'De 1 segundo a 1440 minutos; aceita frações em segundos inteiros.' : 'Informe um tempo positivo de até 1440 minutos, equivalente a segundos inteiros.'}</small>{activeEntry && <p>Finalize a fala atual antes de abrir outra pergunta.</p>}</div></section>
        <section className="question-inbox panel"><div className="inbox-header"><div><span className="kicker">o tanque</span><h2>Perguntas recebidas</h2></div><span className="inbox-count">{waitingQuestions.length} novas</span></div>{waitingQuestions.length === 0 ? <div className="inbox-empty"><span>◌</span><div><strong>Nenhuma pergunta aguardando.</strong><p>Quando alguém enviar, ela aparece aqui para você escolher a próxima onda.</p></div></div> : <div className="question-grid">{waitingQuestions.map((question) => <article className="question-card" key={question.id}><div className="question-card-top"><span className="question-time">{formatRelativeTime(question.createdAt)}</span><span className="question-author"><span className="avatar avatar-tiny">{question.anonymous ? '?' : getInitials(question.authorName)}</span>{question.anonymous ? 'Anônimo' : question.authorName}</span></div><p>{question.text}</p><QuestionVote question={question} onAction={onAction} /><button className="button button-primary button-full" type="button" onClick={() => action({ type: 'select-question', questionId: question.id, durationSeconds: selectedDuration }, 'Pergunta aberta. A fila está liberada.')} disabled={!durationValid || Boolean(activeEntry)}>Abrir esta pergunta</button></article>)}</div>}</section>

        {state.permissions.canFacilitate && <RoomTransfer state={state} onAction={onAction} />}
        {state.permissions.canFacilitate && <section className="session-reset panel"><div><span className="kicker">recomeçar</span><h2>Limpar a conversa</h2><p>Apaga perguntas e falas, mas mantém a sala e seus participantes.</p></div><button className="button button-quiet" type="button" onClick={() => void action({ type: 'reset-session' }, 'A conversa foi reiniciada.')}>Reiniciar sessão</button></section>}
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
    let unsubscribeConnect: (() => Promise<void>) | undefined
    let roomRecordId = ''
    const load = async (join = false) => {
      try {
        const nextState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/state`)
        if (join) {
          const joinedState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST' })
          roomRecordId = joinedState.room.id
          if (!cancelled) setState((current) => !current || joinedState.session.revision >= current.session.revision ? joinedState : current)
          return joinedState
        }
        roomRecordId = nextState.room.id
        if (!cancelled) setState((current) => !current || nextState.session.revision >= current.session.revision ? nextState : current)
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
        unsubscribeConnect = await pocketbase.realtime.subscribe('PB_CONNECT', () => { if (!cancelled) void load() })
        if (!cancelled) await load()
        if (cancelled) { await unsubscribe(); await unsubscribeConnect() }
        else setOnline(true)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    void connect()
    return () => {
      cancelled = true
      void unsubscribe?.()
      void unsubscribeConnect?.()
    }
  }, [onUnauthorized, roomId])

  const onAction = async (action: Action) => {
    try {
      const nextState = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/actions`, { method: 'POST', body: { ...action, expectedControlVersion: state?.session.controlVersion } })
      setState((current) => !current || nextState.session.revision >= current.session.revision ? nextState : current)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      if (error instanceof ApiError && error.status === 409) {
        const refreshed = await requestJson<AppState>(`/rooms/${encodeURIComponent(roomId)}/state`)
        setState((current) => !current || refreshed.session.revision >= current.session.revision ? refreshed : current)
      }
      const nextMessage = error instanceof Error ? error.message : 'Não foi possível atualizar a sala.'
      setMessage(nextMessage)
      throw error
    }
  }

  if (missing) return <div className="not-found"><Brand /><span className="empty-fin">◒</span><h1>Essa sala saiu do radar.</h1><p>Confira o link ou volte para o lobby.</p><a className="button button-primary" href="/">Ver salas abertas</a></div>
  if (!state) return <div className="loading-screen"><span className="loading-fin">◒</span><p>abrindo a sala…</p></div>
  if (facilitator && !state.permissions.canFacilitate) return <div className="not-found"><Brand /><span className="empty-fin">◒</span><h1>Essa sala está em boas mãos.</h1><p>Somente o dono da sala pode abrir o painel de controle.</p><a className="button button-primary" href={roomPath(state.room.slug)}>Participar da sala</a></div>
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

  return <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme((current) => current === 'dark' ? 'light' : 'dark') }}>{content}<footer className="repository-footer"><a className="community-logo" href="https://github.com/PHPcomRapadura" target="_blank" rel="noopener noreferrer"><img src={phpComRapaduraLogo} alt="PHP com Rapadura" width="32" height="32" loading="lazy" /></a><a href="https://github.com/PHPcomRapadura/SharkBowl" target="_blank" rel="noopener noreferrer">Código do SharkBowl no GitHub ↗</a></footer></ThemeContext.Provider>
}

export default App
