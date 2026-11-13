  async function pushProfile(profileData) {
    if (pushing) return;
    pushing = true;

    try {
      const client = await getClient();
      const ch = await findOrCreateSyncChannel();
      const peer = peerOf(ch);

      const profileId = normalizeName(profileData.profile?.id || profileData.profile?.name || 'perfil');
      const filename = `perfil_${profileId}_${nowTimestamp()}.json`;
      const json = JSON.stringify(profileData);
      const bytes = new TextEncoder().encode(json);

      // Forma más compatible con GramJS en navegador
      const { CustomFile } = await import('telegram/client/uploads');
      const file = new CustomFile(filename, bytes.length, '', bytes);

      await client.sendFile(peer, {
        file,
        caption: `Sync ${profileData.profile?.name || profileId}`,
        forceDocument: true,
      });

      // Limpiar versiones antiguas
      const files = await listSyncFiles();
      const mine = files.filter((f) => f.profileId === profileId);
      if (mine.length > MAX_VERSIONS) {
        const toDelete = mine.slice(MAX_VERSIONS);
        for (const f of toDelete) {
          try {
            await client.deleteMessages(peer, [f.messageId], { revoke: true });
          } catch (err) {
            console.warn('[sync] No se pudo borrar versión antigua', f.filename, err);
          }
        }
      }
    } finally {
      pushing = false;
    }
  }
