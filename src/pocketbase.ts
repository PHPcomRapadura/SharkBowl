import PocketBase, { ClientResponseError, type RecordModel } from 'pocketbase'

const configuredUrl = import.meta.env.VITE_POCKETBASE_URL?.trim().replace(/\/+$/, '')

export const pocketbase = new PocketBase(configuredUrl || window.location.origin)

pocketbase.autoCancellation(false)

export const publicAppOrigin = import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/+$/, '') || window.location.origin

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const requestJson = async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
  try {
    return await pocketbase.send<T>(`/api/shark-bowl${path}`, options)
  } catch (error) {
    if (error instanceof ClientResponseError) throw new ApiError(error.response?.message || error.message, error.status)
    throw error
  }
}

export const toIdentity = (record: RecordModel) => ({
  id: record.id,
  name: String(record.name || 'Participante'),
})
