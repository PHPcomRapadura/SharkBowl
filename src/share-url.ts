export const buildPublicRoomUrl = (publicOrigin: string, slug: string) => `${publicOrigin.replace(/\/$/, '')}/s/${encodeURIComponent(slug)}`
