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
      uploadForm.submit();
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

  // Preview modal
  function openPreview(url){
    if (!url) return;
    const els = getPreviewEls();
    if (!els.modal || !els.image) return;
    els.image.src = url;
    els.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closePreview(){
    const els = getPreviewEls();
    if (!els.modal || !els.image) return;
    els.modal.hidden = true;
    els.image.src = '';
    document.body.style.overflow = '';
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
    els.modal.querySelector('img')?.addEventListener('click', closePreview);
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


