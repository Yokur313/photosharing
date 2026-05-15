(function (w) {
  /**
   * @param {{ url: string, method?: string, body: FormData, withCredentials?: boolean,
   *   onProgress?: (p: { percent: number, loaded: number, total: number, speedBps: number, speedLabel: string }) => void,
   *   onDone?: (xhr: XMLHttpRequest) => void, onFail?: () => void }} opts
   */
  function uploadWithProgress(opts) {
    const xhr = new XMLHttpRequest();
    xhr.open((opts.method || 'POST').toUpperCase(), opts.url);
    if (opts.withCredentials) xhr.withCredentials = true;
    const t0 = Date.now();
    let lastLoaded = 0;
    let lastT = t0;
    xhr.upload.onprogress = function (ev) {
      if (!opts.onProgress || !ev.lengthComputable) return;
      const now = Date.now();
      const dt = Math.max(0.001, (now - lastT) / 1000);
      const dBytes = ev.loaded - lastLoaded;
      const instBps = dBytes / dt;
      lastLoaded = ev.loaded;
      lastT = now;
      const percent = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
      let speedLabel = '';
      if (instBps >= 1048576) speedLabel = `${(instBps / 1048576).toFixed(1)} MB/s`;
      else if (instBps >= 1024) speedLabel = `${(instBps / 1024).toFixed(0)} KB/s`;
      else speedLabel = `${Math.round(instBps)} B/s`;
      opts.onProgress({ percent, loaded: ev.loaded, total: ev.total, speedBps: instBps, speedLabel });
    };
    xhr.onload = function () {
      if (opts.onDone) opts.onDone(xhr);
    };
    xhr.onerror = function () {
      if (opts.onFail) opts.onFail();
    };
    xhr.send(opts.body);
  }

  function formatBytes(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${n} B`;
  }

  /**
   * @param {HTMLFormElement} form
   * @param {{ progressEl: HTMLElement, barEl?: HTMLElement, detailEl?: HTMLElement, reloadOnSuccess?: boolean }} ui
   */
  function bindFormUploadProgress(form, ui) {
    if (!form || !ui || !ui.progressEl) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(form);
      const bar = ui.barEl;
      const detail = ui.detailEl;
      ui.progressEl.hidden = false;
      if (bar) bar.style.width = '0%';
      if (detail) detail.textContent = 'Starting…';
      uploadWithProgress({
        url: form.action,
        method: (form.method || 'POST').toUpperCase(),
        body: fd,
        withCredentials: !!form.dataset.withCredentials,
        onProgress: function (p) {
          if (bar) bar.style.width = `${p.percent}%`;
          if (detail) {
            detail.textContent = `${p.percent}% · ${formatBytes(p.loaded)} / ${formatBytes(p.total)} · ${p.speedLabel}`;
          }
        },
        onDone: function (xhr) {
          if (xhr.status >= 200 && xhr.status < 400) {
            if (ui.reloadOnSuccess !== false) window.location.reload();
          } else {
            if (detail) detail.textContent = `Error (${xhr.status})`;
            if (ui.onHttpError) ui.onHttpError(xhr);
          }
        },
        onFail: function () {
          if (detail) detail.textContent = 'Network error';
        },
      });
    });
  }

  w.uploadWithProgress = uploadWithProgress;
  w.bindFormUploadProgress = bindFormUploadProgress;
  w.uploadFormatBytes = formatBytes;
})(window);
