import { fail, handle } from '@/lib/api'
import { sessionManager } from '@/lib/baileys/session-manager'
import { chatDisplayName, formatDateTime } from '@/lib/utils'
import type { MessageDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

function safeFileName(input: string) {
  return input.replace(/[^\w\-. ]+/g, '_').slice(0, 60) || 'chat'
}

function lineFor(message: MessageDTO) {
  const sender = message.fromMe ? 'Saya' : (message.senderName ?? 'Kontak')
  const time = formatDateTime(message.timestamp)
  if (message.deletedAt) return `[${time}] ${sender}: (pesan dihapus)`

  switch (message.type) {
    case 'image':
      return `[${time}] ${sender}: 📷 Foto${message.viewOnce ? ' (sekali lihat)' : ''}${message.text ? ` — ${message.text}` : ''}`
    case 'video':
      return `[${time}] ${sender}: 🎥 Video${message.text ? ` — ${message.text}` : ''}`
    case 'audio':
      return `[${time}] ${sender}: 🎙️ Pesan suara`
    case 'document':
      return `[${time}] ${sender}: 📄 Dokumen (${message.mediaName ?? 'file'})`
    case 'sticker':
      return `[${time}] ${sender}: 🩹 Sticker`
    default:
      return `[${time}] ${sender}: ${message.text ?? `[${message.type}]`}`
  }
}

/**
 * GET /api/chats/:chatId/export?format=txt|json
 * Unduh riwayat percakapan dari database panel.
 */
export async function GET(request: Request, { params }: { params: { chatId: string } }) {
  return handle(async () => {
    const data = await sessionManager.exportChat(params.chatId)
    if (!data) return fail('Chat tidak ditemukan', 404)

    const format = new URL(request.url).searchParams.get('format') === 'json' ? 'json' : 'txt'
    const baseName = safeFileName(chatDisplayName({ name: data.chat.name, jid: data.chat.jid }))

    if (format === 'json') {
      return new Response(JSON.stringify(data, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${baseName}.json"`,
        },
      })
    }

    const header = [
      `Ekspor percakapan: ${chatDisplayName({ name: data.chat.name, jid: data.chat.jid })}`,
      `Nomor: +${data.chat.jid.split('@')[0]}`,
      `Sesi: ${data.session.name} (+${data.session.phoneNumber})`,
      `Diekspor: ${formatDateTime(data.exportedAt)}`,
      `Jumlah pesan: ${data.messages.length}`,
      ''.padEnd(60, '='),
      '',
    ].join('\n')

    const body = data.messages.map(lineFor).join('\n')

    return new Response(`${header}${body}\n`, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${baseName}.txt"`,
      },
    })
  })
}
