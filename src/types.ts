export type SessionPhase = 'lobby' | 'running' | 'closed'
export type QuestionStatus = 'waiting' | 'active' | 'closed'
export type EntryStatus = 'waiting' | 'speaking' | 'finished'

export type Identity = {
  id: string
  name: string
}

export type Room = {
  id: string
  slug: string
  title: string
  access: 'public'
  ownerId: string | null
  createdAt: number
  updatedAt: number
}

export type RoomSummary = Room & {
  participantCount: number
  questionCount: number
  phase: SessionPhase
}

export type LobbyState = {
  rooms: RoomSummary[]
}

export type Participant = {
  id: string
  name: string
  lastSeenAt: number
}

export type Question = {
  id: string
  text: string
  authorName: string
  anonymous: boolean
  createdAt: number
  status: QuestionStatus
}

export type QueueEntry = {
  id: string
  questionId: string
  participantId: string
  participantName: string
  createdAt: number
  status: EntryStatus
  replyToEntryId: string | null
  replyToName: string | null
}

export type Session = {
  id: string
  phase: SessionPhase
  activeQuestionId: string | null
  activeEntryId: string | null
  speechStartedAt: number | null
  durationSeconds: number
  updatedAt: number
}

export type RoomPermissions = {
  canFacilitate: boolean
}

export type AppState = {
  room: Room
  session: Session
  questions: Question[]
  queue: QueueEntry[]
  participants: Participant[]
  permissions: RoomPermissions
}

export type Action =
  | { type: 'join-room' }
  | { type: 'submit-question'; text: string; anonymous: boolean }
  | { type: 'join-queue'; replyToEntryId?: string | null }
  | { type: 'select-question'; questionId: string }
  | { type: 'start-next' }
  | { type: 'finish-current' }
  | { type: 'set-duration'; durationSeconds: 120 | 180 }
  | { type: 'close-question' }
  | { type: 'reset-session' }
