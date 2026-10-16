; Buffer transitions contain no I/O or UI work. The editor owns when they run.
(let new (fn (path source revision)
  (dict "path" path "source" source "saved-source" source "file-revision" revision
    "anchor" 0 "head" 0 "scroll" 0 "scroll-x" 0 "version" 0 "composing" false
    "dirty" false "pending" false "elapsed" 0 "error" "" "auto" true "focused" false
    "locked" (= path "") "saving" false "switching" false "reloading" false "need-reload" false
    "status" (if (= path "") "No file open" "Saved"))))

(let changed (fn (buffer)
  (set buffer.dirty (not (= buffer.source buffer.saved-source)))
  (set buffer.pending buffer.dirty)
  (set buffer.elapsed 0)
  (set buffer.status (if buffer.dirty "Unsaved" "Saved"))))

; A completed write acknowledges its captured version, never newer edits.
(let saved (fn (buffer source revision version)
  (set buffer.file-revision revision)
  (set buffer.saved-source source)
  (set buffer.error "")
  (set buffer.dirty (and (not (= version buffer.version)) (not (= buffer.source source))))
  (set buffer.pending buffer.dirty)
  (set buffer.status (if buffer.dirty "Unsaved" "Saved"))))

; Replace a document without deciding its path, selection, focus, or lock policy.
(let replace (fn (buffer source revision)
  (set buffer.source source)
  (set buffer.version (+ buffer.version 1))
  (saved buffer source revision buffer.version)))

; Dirty means edits exist; pending means autosave should try. A failed save
; leaves dirty true and pending false, so it needs an edit or an explicit retry.
(let Buffer (dict "new" new "changed" changed "saved" saved "replace" replace))
