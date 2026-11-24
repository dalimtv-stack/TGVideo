// Shared in-memory cache for titles derived from external Telegram channels.
export const EXT_CHANNEL_TITLES_CACHE = new Map();

export function clearExternalChannelCache(channelId) {
  if (channelId) {
    EXT_CHANNEL_TITLES_CACHE.delete(String(channelId));
    return;
  }
  EXT_CHANNEL_TITLES_CACHE.clear();
}
