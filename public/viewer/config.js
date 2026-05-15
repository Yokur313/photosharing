// Optional override for split hosting (e.g. static site on another origin).
// Same Scaleway deployment: leave empty so requests use this host.
window.API_BASE = window.API_BASE || '';

/** @param {string} path Must start with / */
window.apiUrl = function apiUrl(path) {
  const b = (window.API_BASE || '').replace(/\/$/, '');
  if (!b) return path;
  return b + path;
};
