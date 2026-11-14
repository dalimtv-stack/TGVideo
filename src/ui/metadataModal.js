  const telegramFileName = title.archivos?.[0]?.fileName || title.nombre || '';
  const telegramChannel = title.channel?.title || title.channel?.name || title.grupo || '';

  const statusText = currentMeta
    ? `Identificación actual: <strong>${esc(currentMeta.name)}</strong> (${esc(currentMeta.date?.slice(0, 4) || 's/f')}) · TMDB ID: ${currentMeta.id}`
    : '<em>Sin identificar en TMDB actualmente.</em>';

  const modalTitle = `Archivo en Telegram: ${telegramFileName}`;
  const modalSubtitle = telegramChannel ? `<strong>Canal en Telegram:</strong> ${esc(telegramChannel)}` : '';

  const { overlay, close } = modal(modalTitle, `
    <div class="meta-modal-body">
      <div class="meta-current-box">${statusText}</div>
      ...
  `, modalSubtitle);
