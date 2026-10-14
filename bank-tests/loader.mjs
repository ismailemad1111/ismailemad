import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const map = {
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js": "stubs/app.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js": "stubs/firestore.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js": "stubs/auth.js"
};
export async function resolve(specifier, context, next) {
  if (map[specifier]) return { url: pathToFileURL(path.join(here, map[specifier])).href, shortCircuit: true };
  return next(specifier, context);
}
