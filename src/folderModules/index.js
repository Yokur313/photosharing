// Registry of "folder modules" — self-contained tools that operate on a single
// (non-root) folder from the admin console. Collage is the first; adding another
// is just a new file exporting the same shape and one line in `folderModules`.
//
// A module is: { id, label, description, async run({ prefix }) -> { message, resultKey? } }
// `run` throws on failure. Throw via `userError(msg)` for messages that are safe
// (and intended) to show the admin verbatim; any other throw is treated as a 500.
import { collageModule } from './collage.js';

export const folderModules = [collageModule];

export function getFolderModule(id) {
  return folderModules.find((m) => m.id === id) || null;
}

/** View-safe descriptors (no `run`) for rendering toolbar buttons. */
export function folderModuleDescriptors() {
  return folderModules.map(({ id, label, description }) => ({ id, label, description }));
}

/** Build an error whose message is safe to surface to the admin (HTTP 400). */
export function userError(message) {
  const e = new Error(message);
  e.userError = true;
  return e;
}
