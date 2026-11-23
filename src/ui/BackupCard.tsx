import { useRef, useState } from 'react'
import { t } from '../i18n'
import { backupFileName, makeBackup, parseBackup, type BackupData, type BackupFile } from '../storage/backup'
import { Sheet } from './widgets'

async function deliver(text: string, name: string): Promise<boolean> {
  const file = new File([text], name, { type: 'application/json' })
  // Phones: the share sheet ("Save to Files", send to self). Elsewhere: a normal download.
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return true
    } catch {
      return false
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

export function BackupCard(props: {
  data: () => BackupData
  lastBackupMs: number | undefined
  onSaved: (ms: number) => void
  onRestore: (b: BackupFile) => void
  toast: (msg: string) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<BackupFile | null>(null)
  const days = props.lastBackupMs === undefined ? null : Math.floor((Date.now() - props.lastBackupMs) / 86_400_000)

  const doExport = async () => {
    const now = new Date()
    const ok = await deliver(JSON.stringify(makeBackup(props.data(), now), null, 1), backupFileName(now))
    if (ok) {
      props.onSaved(now.getTime())
      props.toast(t.backup.saved)
    }
  }
  const doImport = async (file: File | undefined) => {
    if (!file) return
    const res = parseBackup(await file.text())
    if (!res.ok) props.toast(t.backup.errors[res.error])
    else setPreview(res.data)
    if (fileInput.current) fileInput.current.value = ''
  }

  return (
    <div className="card">
      <h2>{t.backup.title}</h2>
      <p className="muted small-print">{t.backup.hint}</p>
      <p className={days === null || days > 14 ? 'warn small-print' : 'muted small-print'}>
        {days === null ? t.backup.never : t.backup.last(days)}
        {days !== null && days > 14 ? ` · ${t.backup.old}` : ''}
      </p>
      <div className="inline">
        <button type="button" className="btn" onClick={() => void doExport()}>
          {t.backup.export}
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          {t.backup.import}
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void doImport(e.target.files?.[0])} />
      </div>
      {preview && (
        <Sheet onClose={() => setPreview(null)}>
          <h2>{t.backup.previewTitle}</h2>
          <p>
            {t.backup.previewBody(
              preview.soldiers.length,
              preview.roles.length,
              preview.plan !== null,
              new Date(preview.exportedAt).toLocaleString('he-IL'),
            )}
          </p>
          <p className="warn">{t.backup.replaceWarn}</p>
          <button
            type="button"
            className="btn primary big"
            onClick={() => {
              props.onRestore(preview)
              setPreview(null)
              props.toast(t.backup.restored)
            }}
          >
            {t.backup.confirm}
          </button>
          <button type="button" className="btn" onClick={() => setPreview(null)}>
            {t.board.cancel}
          </button>
        </Sheet>
      )}
    </div>
  )
}
