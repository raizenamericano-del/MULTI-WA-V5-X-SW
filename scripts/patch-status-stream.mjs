// Pinned Baileys 6.7.24: propagate source network errors and cancel upstream
// when the decrypted output is destroyed (timeout, quota, client cancellation).
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const main = require.resolve('@whiskeysockets/baileys')
const file = new URL('./Utils/messages-media.js', `file://${main}`)
const before = 'return fetched.pipe(output, { end: true });'
const after = `fetched.on('error', error => output.destroy(error));
    output.on('close', () => fetched.destroy());
    return fetched.pipe(output, { end: true });`
let source = fs.readFileSync(file, 'utf8')
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('Baileys media source changed: review stream patch')
  source = source.replace(before, after)
  fs.writeFileSync(file, source)
}
console.log('Baileys media stream lifecycle patch verified')
