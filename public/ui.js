(function(){
  const dropzone = document.getElementById('od-dropzone');
  const uploadForm = document.getElementById('od-upload-form');
  const fileInput = document.getElementById('od-file-input');
  const shareBtn = document.getElementById('od-share-btn');
  function getPreviewEls(){
    return {
      modal: document.getElementById('preview-modal'),
      image: document.getElementById('preview-image')
    };
  }

  function currentPrefix(){
    const el = document.querySelector('input[name="prefix"]');
    return el ? el.value : '';
  }

  function uploadFiles(files){
    if (!files || !files.length) return;
    const formData = new FormData();
    formData.append('prefix', currentPrefix());
    Array.from(files).forEach(f => formData.append('photos', f));
    const z = document.getElementById('od-upload-progress');
    const bar = z && z.querySelector('.bar');
    const det = z && z.querySelector('.detail');
    if (z) z.hidden = false;
    if (bar) bar.style.width = '0%';
    if (det) det.textContent = 'Uploading…';
    if (window.uploadWithProgress) {
      window.uploadWithProgress({
        url: '/admin/upload',
        method: 'POST',
        body: formData,
        onProgress: function(p){
          if (bar) bar.style.width = p.percent + '%';
          if (det && window.uploadFormatBytes) det.textContent = p.percent + '% · ' + window.uploadFormatBytes(p.loaded) + ' / ' + window.uploadFormatBytes(p.total) + ' · ' + p.speedLabel;
        },
        onDone: function(xhr){
          if (xhr.status >= 200 && xhr.status < 400) window.location.reload();
          else if (det) det.textContent = 'Error (' + xhr.status + ')';
        },
        onFail: function(){ if (det) det.textContent = 'Network error'; }
      });
      return;
    }
    fetch('/admin/upload', { method: 'POST', body: formData })
      .then(() => window.location.reload())
      .catch(() => window.location.reload());
  }

  if (dropzone) {
    ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add('dragover');
    }));
    ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', e => {
      const dt = e.dataTransfer;
      const files = dt && dt.files ? dt.files : [];
      uploadFiles(files);
    });
  }

  if (fileInput && uploadForm) {
    fileInput.addEventListener('change', () => {
      if (!fileInput.files || !fileInput.files.length) return;
      if (uploadForm.requestSubmit) uploadForm.requestSubmit();
      else uploadForm.submit();
    });
  }

  function createShare(folderKey){
    const password = prompt('Optional password for this share (leave blank for none):');
    const editable = confirm('Allow people with the link to upload photos to this folder?');
    fetch('/admin/share/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderKey, password, editable })
    }).then(r => r.json()).then(data => {
      if (data && data.url) {
        const full = `${window.location.origin}${data.url}`;
        // robust clipboard fallback
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(full).then(()=>{
            alert(`Share created and copied to clipboard:\n${full}`);
          }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = full; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); alert(`Share created and copied to clipboard:\n${full}`); }
            catch(_) { alert(`Share created:\n${full}`); }
            finally { document.body.removeChild(ta); }
          });
        } else {
          const ta = document.createElement('textarea');
          ta.value = full; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); alert(`Share created and copied to clipboard:\n${full}`); }
          catch(_) { alert(`Share created:\n${full}`); }
          finally { document.body.removeChild(ta); }
        }
      } else {
        alert('Failed to create share');
      }
    }).catch(() => alert('Failed to create share'));
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const folder = shareBtn.getAttribute('data-folder') || '';
      createShare(folder);
    });
  }

  document.querySelectorAll('.od-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const folder = btn.getAttribute('data-folder');
      createShare(folder);
    });
  });

  // Folder modules (e.g. collage): POST to the generic endpoint, show the result.
  document.querySelectorAll('.od-folder-module').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleId = btn.getAttribute('data-module');
      const folder = btn.getAttribute('data-folder') || currentPrefix();
      const label = (btn.textContent || 'this action').trim();
      if (!confirm(`Run "${label}" on this folder?`)) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Working…';
      fetch('/admin/folder/module', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: folder, moduleId })
      }).then(async r => {
        let data = {};
        try { data = await r.json(); } catch(_) {}
        if (r.ok && data && data.ok) {
          alert(data.message || 'Done.');
          window.location.reload();
        } else {
          alert((data && data.error) ? data.error : ('Failed (' + r.status + ')'));
          btn.disabled = false;
          btn.textContent = original;
        }
      }).catch(() => {
        alert('Network error — the operation may not have completed.');
        btn.disabled = false;
        btn.textContent = original;
      });
    });
  });

  // Preview modal
  function resetZoom(modal){
    if (!modal) return;
    modal.classList.remove('zoomed');
    modal.scrollTop = 0;
    modal.scrollLeft = 0;
  }
  function openPreview(url){
    if (!url) return;
    const els = getPreviewEls();
    if (!els.modal || !els.image) return;
    resetZoom(els.modal); // always open fitted-to-screen, not left in a prior zoom state
    els.image.src = url;
    els.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closePreview(){
    const els = getPreviewEls();
    if (!els.modal || !els.image) return;
    els.modal.hidden = true;
    resetZoom(els.modal);
    els.image.src = '';
    document.body.style.overflow = '';
  }
  // Toggle between fit-to-screen and full resolution, centering on the clicked point.
  function toggleZoom(e){
    const els = getPreviewEls();
    if (!els.modal || !els.image) return;
    if (els.modal.classList.contains('zoomed')) { resetZoom(els.modal); return; }
    const rect = els.image.getBoundingClientRect(); // fitted size/position at click time
    const fx = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
    const fy = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
    els.modal.classList.add('zoomed');
    requestAnimationFrame(() => {
      const full = els.image.getBoundingClientRect(); // natural size now
      els.modal.scrollLeft = Math.max(0, fx * full.width - els.modal.clientWidth / 2);
      els.modal.scrollTop = Math.max(0, fy * full.height - els.modal.clientHeight / 2);
    });
  }
  document.querySelectorAll('.od-preview').forEach(btn => {
    btn.addEventListener('click', async () => {
      let url = btn.getAttribute('data-url');
      if (!url) {
        const key = btn.closest('.od-row').getAttribute('data-key');
        try {
          const r = await fetch(`/admin/sign?key=${encodeURIComponent(key)}`);
          const j = await r.json();
          url = j.url;
          btn.setAttribute('data-url', url);
        } catch(_) {}
      }
      openPreview(url);
    });
  });
  (function(){
    const els = getPreviewEls();
    if (!els.modal) return;
    els.modal.querySelector('.modal-close').addEventListener('click', closePreview);
    els.modal.querySelector('.modal-backdrop').addEventListener('click', closePreview);
    els.modal.querySelector('img')?.addEventListener('click', (e) => { e.stopPropagation(); toggleZoom(e); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) closePreview(); });
  })();

  // Confirm before delete
  document.querySelectorAll('form[action="/admin/delete"], form[action="/admin/folder/delete"]').forEach(form => {
    form.addEventListener('submit', (e) => {
      const isFolder = form.action.endsWith('/admin/folder/delete');
      const ok = confirm(isFolder ? 'Delete this folder and all contents?' : 'Delete this file?');
      if (!ok) e.preventDefault();
    });
  });
})();


