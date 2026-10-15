; The editor is composed from ordinary, editable Lisp UI components.
; Library: hg/ui.lisp. Source control: editor/code-editor.lisp.
(await (import "../hg/ui.lisp"))
(let Editor (await (import "./code-editor.lisp")))
(let Theme (await (import "./theme.lisp")))
(let Files (await (import "./files.lisp")))
(let Inspector (await (import "./inspector.lisp")))
(let ProjectModule (await (import "./project.lisp")))
(let Project ProjectModule.Project)
(let state app.state)
(let saved-entry (fs-stat "/editor/main.lisp"))
(if (= state.editor nil) (set state.editor (dict
  "source" (if saved-entry (await (fs-read-text "/editor/main.lisp")) app.source)
  "path" (if saved-entry "/editor/main.lisp" "") "locked" (not saved-entry)
  "anchor" 0 "head" 0 "scroll" 0 "scroll-x" 0 "version" 0
  "composing" false "pending" false "elapsed" 0 "error" "" "auto" true)))
(let model state.editor)
; Transient flags may be absent in saved buffers or the recovery fallback model.
(for key (list "saving" "switching" "reloading" "need-reload")
  (if (= (get model.(get key)) nil) (put model key false)))
(if (= model.path nil) (set model.path "/editor/main.lisp"))
(if (= model.file-revision nil) (set model.file-revision (if saved-entry saved-entry.revision 0)))
(if (= model.saved-source nil) (set model.saved-source model.source))
(if (= model.status nil) (set model.status (if (= model.path "") "No file open" "Saved")))
(if (= model.preview-view nil) (set model.preview-view (dict
  "path" "" "image" nil "revision" 0 "mime" "" "size" 0 "pan" (vec2) "zoom" 1 "fit" true)))
(let preview model.preview-view)
; Migrate a binary buffer left by the former preview inside the Source pane.
(if model.binary {
  (set preview.path model.path) (set preview.image model.preview)
  (set preview.mime model.mime) (set preview.size model.file-size)
  (set model.path (if saved-entry "/editor/main.lisp" ""))
  (set model.source (if saved-entry (await (fs-read-text model.path)) ""))
  (set model.saved-source model.source) (set model.file-revision (if saved-entry saved-entry.revision 0))
  (set model.anchor 0) (set model.head 0) (set model.scroll 0) (set model.scroll-x 0)
  (set model.binary false) (set model.preview nil) (set model.dirty false) (set model.pending false)
  (set model.locked (not saved-entry))
})
(if (and (not (= preview.path "")) (= preview.image nil)) {
  (let entry (fs-stat preview.path))
  (if (or (= entry nil) (not (= entry.kind "file"))) (set preview.path "") else {
    (set preview.revision entry.revision) (set preview.mime entry.mime) (set preview.size entry.size)
    (if entry.image (await (promise (image (fs-url preview.path))
      then (texture) (set preview.image texture)
      catch (error) { (set model.error error.message) (set preview.path "") })))
  })
})
(if state.boot-error { (set model.error state.boot-error) (set state.boot-error nil) })
(if (= state.layout nil) (set state.layout (dict)))
(if (= state.tools nil) (set state.tools (dict)))
(if (= state.tools.bindings nil) (set state.tools.bindings (dict)))
(for key (list "bindings-scroll" "diagnostics-scroll")
  (if (= (get state.tools.(get key)) nil) (put state.tools key (dict "x" 0 "y" 0))))
(let desktop nil)
(let workspace nil)
(let diagnostics nil)
(let inspector nil)
(let source-node nil)
(let source-pane nil)
(let preview-node nil)
(let preview-pane nil)
(let preview-label nil)
(let path-label nil)
(let status-label nil)
(let reopen-prompt nil)
(let inspect-elapsed 1)
(let editor-observation nil)

(let save-file (fn ()
  (if model.saving (return model.save-promise))
  (if (not model.dirty) (return (promise true)))
  (if (= model.path "") {
    (set model.error "Create or open a file before saving this buffer.")
    (set model.pending false) (return (promise false))
  })
  (let path model.path)
  (let source model.source)
  (let requested model.version)
  (set model.saving true) (set model.status "Saving...")
  (set model.save-promise (promise (fs-write-text path source model.file-revision)
    then (entry) {
      (set model.file-revision entry.revision)
      (set model.saved-source source)
      (set model.saving false)
      (set model.error "")
      (if (= requested model.version) {
        (set model.dirty false) (set model.pending false) (set model.status "Saved")
      } else {
        (set model.dirty (not (= model.source source)))
        (set model.pending model.dirty)
        (set model.status (if model.dirty "Unsaved" "Saved"))
      })
      (if (or (fs-contains "/editor" path) (fs-contains "/hg" path)) (set model.need-reload true))
      true
    } catch (error) {
      (set model.saving false) (set model.status "Save failed")
      (set model.pending false) (set model.error error.message) false
    }))
  model.save-promise))
(let flush-file (async (fn ()
  (if model.saving (if (not (await model.save-promise)) (return false)))
  (while model.dirty (if (not (await (save-file))) (return false)))
  true)))
(let reload-editor (async (fn ()
  (if (or model.reloading model.switching model.files.busy) (return false))
  (set model.reloading true)
  (if (not (await (flush-file))) { (set model.reloading false) (return false) })
  (set model.need-reload false) (set model.error "")
  (promise (App.reloadModules app (or state.editor-entry (fs-url "/editor/main.lisp")))
    then () { (set model.reloading false) true }
    catch (error) {
      (set model.reloading false) (set model.error error.message)
      (set model.status "Saved; reload failed") false
    }))))
(let __lock__ (fn (locked)
  (set model.locked locked)
  (if source-node.state.proxy (TextProxy.readOnly source-node.state.proxy locked))))
(let update-editor-bundle (async (fn ()
  (if (or model.reloading model.switching model.files.busy) (return false))
  (let previous-lock (bool model.locked))
  (set model.reloading true) (__lock__ true)
  (promise {
    (if (not (await (flush-file))) {
      (set model.reloading false) (__lock__ previous-lock) (return false)
    })
    (let report (await (Project.resetEditor app.filesystem (await (editor-default-files)))))
    (set state.bundle-backup report.backup)
    (if (in model.path report.updated) {
      (let entry (fs-stat model.path))
      (set model.source (await (fs-read-text model.path)))
      (set model.saved-source model.source) (set model.file-revision entry.revision)
      (set model.version (+ model.version 1))
      (set model.dirty false) (set model.pending false)
      (set model.anchor (min model.anchor (len model.source)))
      (set model.head (min model.head (len model.source)))
    })
    (set model.reloading false) (__lock__ previous-lock)
    (set model.status "Saved")
    (await (editor-resume))
  } catch (error) {
    (set model.reloading false) (__lock__ previous-lock)
    (set model.error error.message) false
  }))))
(let save-project (async (fn ()
  (if (or model.reloading model.switching model.files.busy) (return false))
  (promise {
    (if (not (await (flush-file))) (return false))
    (await (Project.saveState app.filesystem state))
    (Resources.download "project.json" (await (Project.snapshot app.filesystem state)))
    true
  } catch (error) { (set model.error error.message) false }))))
(let open-project (async (fn ()
  (if (or model.reloading model.switching model.files.busy) (return false))
  (set model.reloading true) (__lock__ true)
  (promise {
    (let selected (await (Resources.openText)))
    (if (= selected nil) { (set model.reloading false) (__lock__ false) (return false) })
    (if (not (await (flush-file))) { (set model.reloading false) (__lock__ false) (return false) })
    (await (Project.saveState app.filesystem state))
    (await (Project.open app.filesystem selected.text))
    (await (project-reload))
  } catch (error) {
    (set model.reloading false) (__lock__ false) (set model.error error.message) false
  }))))
(let new-project (async (fn ()
  (if (or model.reloading model.switching model.files.busy) (return false))
  (set model.reloading true) (__lock__ true)
  (promise {
    (if (not (await (flush-file))) { (set model.reloading false) (__lock__ false) (return false) })
    (await (Project.saveState app.filesystem state))
    (set app.filesystem.assetURL (project-base-url))
    (await (Project.create app.filesystem (await (project-default-files))))
    (await (project-reload))
  } catch (error) {
    (set model.reloading false) (__lock__ false) (set model.error error.message) false
  }))))
(let resume-editor (async (fn ()
  (promise {
    (if (not (await (flush-file))) (return false))
    (await (Project.saveState app.filesystem state))
    (await (editor-resume))
  } catch (error) { (set model.error error.message) false }))))
(let __show-source__ (fn ()
  (if (or source-pane.state.minimized source-pane.state.closed) (ui-pane-restore desktop source-pane))))
(let __open-preview__ (async (fn (entry)
  (if (or model.switching model.reloading) (return false))
  (set model.switching true)
  (promise {
    (let texture (if entry.image (await (image (fs-url entry.path))) nil))
    (if (or (not (= preview.path entry.path)) (not (= preview.revision entry.revision))) {
      (set preview.pan (vec2)) (set preview.zoom 1) (set preview.fit true)
    })
    (set preview.path entry.path) (set preview.revision entry.revision)
    (set preview.image texture) (set preview.mime entry.mime) (set preview.size entry.size)
    (set preview-pane.props.title (if entry.image "Image preview" "File information"))
    (set model.switching false) (set model.error "")
    (ui-pane-open desktop preview-pane)
    (ui-focus desktop (ui-path desktop.root preview-node))
    (ui-invalidate desktop)
    true
  } catch (error) {
    (set model.switching false) (set model.error error.message) false
  }))))
(let __load-file__ (async (fn (path)
  (if (or model.switching model.reloading) (return false))
  (__show-source__)
  (let previous-lock (bool model.locked))
  (set model.switching true) (__lock__ true)
  (promise {
    (if (not (await (flush-file))) {
      (set model.switching false) (__lock__ previous-lock) (return false)
    })
    (let entry (fs-stat path))
    (if (= entry nil) (await (fs-read-text path)))
    (let source (await (fs-read-text path)))
    (set model.path path) (set model.file-revision entry.revision)
    (set model.source source) (set model.saved-source source)
    (set model.anchor 0) (set model.head 0) (set model.scroll 0) (set model.scroll-x 0)
    (set model.version (+ model.version 1))
    (set model.dirty false) (set model.pending false) (set model.error "")
    (set model.status "Saved") (set model.switching false) (__lock__ false)
    (TextProxy.sync source-node.state.proxy source 0 0)
    (set source-node.state.document (TextProxy.snapshot source-node.state.proxy))
    (set model.source source-node.state.document.content)
    (set model.saved-source model.source)
    (ui-focus desktop (ui-path desktop.root source-node))
    (ui-invalidate desktop)
    true
  } catch (error) {
    (set model.switching false) (__lock__ previous-lock) (set model.error error.message) false
  }))))
(let open-file (fn (path)
  (if (or model.reloading model.switching) (return false))
  (let entry (fs-stat path))
  (if (and entry (or entry.image (not entry.text))) (return (__open-preview__ entry)))
  (if (and entry (= path model.path) (= entry.revision model.file-revision)) {
    (__show-source__)
    (ui-focus desktop (ui-path desktop.root source-node))
    (return false)
  })
  (__load-file__ path)))
(let reopen-file (async (fn ()
  (if (or model.switching model.reloading model.files.busy (= model.path "")) (return false))
  (if model.saving (await model.save-promise))
  (let dirty model.dirty)
  (promise {
    (await (fs-refresh))
    (set model.dirty false) (set model.pending false) (set model.confirm-reopen false)
    (let opened (await (__load-file__ model.path)))
    (if (not opened) (set model.dirty dirty))
    opened
  } catch (error) {
    (set model.dirty dirty) (set model.error error.message) false
  }))))

(let __removed__ (fn (path)
  (if (and (not (= preview.path "")) (fs-contains path preview.path)) {
    (set preview.path "") (set preview.image nil)
    (ui-pane-close desktop preview-pane)
  })
  (if (and (not (= model.path "")) (fs-contains path model.path)) {
    (ui-focus desktop (list))
    (set model.path "") (set model.source "") (set model.saved-source "")
    (set model.anchor 0) (set model.head 0) (set model.scroll 0) (set model.scroll-x 0)
    (set model.binary false) (set model.preview nil) (set model.dirty false)
    (set model.pending false) (set model.need-reload false) (set model.status "No file open")
    (__lock__ true)
  })))

(let build-editor (fn ()
  (set diagnostics (ui-label "" (font Theme.font)
    (size Theme.size) (v-align "top")))
  (set inspector (Inspector.bindings-pane state.tools.bindings))
  (set source-node (Editor.code-editor model
    (on change () {
      (set model.dirty (not (= model.source model.saved-source)))
      (set model.pending model.dirty) (set model.elapsed 0)
      (set model.status (if model.dirty "Unsaved" "Saved"))
    })))
  (set preview-node (Files.file-preview preview))
  (set preview-label (ui-label "" (size Theme.small-size)
    (ui-prop "marquee" true)))
  (set preview-pane (ui-pane (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.image) "Image preview")
    (ui-prop "id" "image-preview")
    (ui-prop "floating" true)
    (ui-prop "closed" (= preview.path ""))
    (ui-prop "float-w" 640)
    (ui-prop "float-h" 480)
    preview-label
    (ui-bar (height 34)
      (padding 2)
      (ui-button "Fit" (on click () {
        (set preview.fit true) (set preview.pan (vec2)) (ui-repaint desktop)
      }))
      (ui-button "1:1" (on click () {
        (set preview.fit false) (set preview.zoom 1) (set preview.pan (vec2)) (ui-repaint desktop)
      }))
      (ui-label "Drag to pan; wheel to zoom" (size Theme.small-size)))
    preview-node))
  (set path-label (ui-label "" (size Theme.small-size)
    (grow 1)
    (ui-prop "marquee" true)
    (v-align "center")))
  (set status-label (ui-label "" (size Theme.small-size)
    (v-align "center")))
  (set reopen-prompt (ui-vbox (visible false)
    (gap 4)
    (ui-label "Discard the draft and reopen?")
    (ui-hbox
      (ui-button "Discard & reopen" (on click () (reopen-file)))
      (ui-button "Cancel" (on click () (set model.confirm-reopen false))))))
  (set source-pane (ui-pane (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.code) "Source")
    (ui-hbox path-label status-label) reopen-prompt source-node))
  (set workspace (ui-dock
    (ui-prop "layout" state.layout)
    (ui-pane (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.folder) "Files")
      (Files.files-pane model flush-file
        (on open (event) (open-file event.path))
        (on move (event) {
          (if (not (= model.path "")) (set model.path (fs-rebase model.path event.from event.to)))
          (if (not (= preview.path "")) (set preview.path (fs-rebase preview.path event.from event.to)))
        })
        (on remove (event) (__removed__ event.path))))
    source-pane
    preview-pane
    (ui-pane (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.generator) "Bindings")
      (ui-scroll (ui-prop "scroll-x" true) (ui-prop "scroll-state" state.tools.bindings-scroll) inspector))
    (ui-pane (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.command) "Diagnostics")
      (ui-scroll (ui-prop "scroll-x" true) (ui-prop "scroll-state" state.tools.diagnostics-scroll) diagnostics))))
  (ui-new (ui-vbox (gap 0)
    (ui-menu
      (ui-label "Mercury" (size Theme.heading-size)
        (padding Theme.text-padding))
      (ui-label "Recovery editor (F2)" (visible (= state.editor-mode "recovery"))
        (size Theme.small-size))
      (ui-dropdown (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.file) "Project")
        (ui-button "New project" (on click () (new-project)))
        (ui-button "Open project" (on click () (open-project)))
        (ui-button "Save project" (on click () (save-project)))
        (ui-button "Save now" (on click () (save-file)))
        (ui-button "Reload editor" (on click () (reload-editor)))
        (ui-button "Resume project editor" (on click () (resume-editor)))
        (ui-button "Restore default editor" (on click () (update-editor-bundle)))
        (ui-button "Reopen saved file" (on click () {
          (if (not (= model.path "")) { (__show-source__) (set model.confirm-reopen true) })
        }))
        (ui-button "Refresh files" (on click ()
          (promise (fs-refresh) catch (error) (set model.error error.message))))
        (ui-button "Reset draft" (on click () {
          (if (or model.switching model.files.busy) (return))
          (set model.source model.saved-source)
          (set model.version (+ model.version 1))
          (set model.anchor 0)
          (set model.head 0)
          (set model.scroll-x 0)
          (set model.pending false)
          (set model.dirty false) (set model.status "Saved")
        })))
      (ui-dropdown (ui-hbox (gap 4) (v-align "center") (ui-icon Theme.icons.main) "View")
        (ui-button "Reset layout" (on click () {
          (set state.layout (dict))
          (reload-editor)
        }))
        (ui-button "Restore minimized panes" (on click (event) {
          (for pane workspace.state.panes
            (if pane.state.minimized (ui-pane-restore event.ui pane)))
        })))
      (ui-dropdown "Assets"
        (ui-label "Asset base URL (Enter to apply)")
        (ui-textbox app.filesystem.assetURL (width 360)
          (grow 0)
          (on submit (event) {
            (promise {
              (set app.filesystem.assetURL (Resources.directoryURL event.value))
              (await (Project.saveState app.filesystem state))
              (set model.error "")
            } catch (error) (set model.error error.message))
          })))
      (ui-button (ui-icon Theme.icons.play) (ui-label (if model.auto "Live editor: on" "Live editor: off"))
        (on click (event) {
          (set model.auto (not model.auto))
          (set (get event.current-target.children.1).props.value
            (if model.auto "Live editor: on" "Live editor: off"))
        }))
      (ui-label "Drag pane titles to dock; wheel to scroll bars"
        (size Theme.small-size)
        (padding Theme.bar-padding)))
    workspace
    (ui-taskbar workspace (ui-label "Minimized" (size Theme.small-size)
      (padding Theme.text-padding)))))))

(on attach ()
  (set desktop (build-editor))
  (Theme.apply desktop)
  (set diagnostics.props.color Theme.pink)
  (set desktop.observe false)
  (set inspect-elapsed 1)
  (set editor-observation nil)
  (set desktop.scale (or state.pixel-ratio 1))
  (ui-mount desktop)
  (if (not model.dirty) (set model.saved-source model.source)))
(on detach () (if desktop (ui-unmount desktop)))

(on update (context)
  (ui-update desktop context)
  (set inspect-elapsed (+ inspect-elapsed context.dt))
  (if (and model.pending (not model.saving) (not model.composing) (not model.switching)) {
    (set model.elapsed (+ model.elapsed context.dt))
    (if (>= model.elapsed Theme.save-delay) (save-file))
  })
  (if (and model.auto model.need-reload (not model.dirty) (not model.saving)
    (not model.reloading) (not model.switching) (not model.files.busy)) (reload-editor)))

(on render (context)
  (set desktop.scale (or state.pixel-ratio 1))
  ; Observe the editor model explicitly; idle frames need no tree walk or layout.
  (let observed (list model.source model.anchor model.head model.scroll model.scroll-x model.error
    model.path model.status model.confirm-reopen preview.path preview.mime preview.size app.filesystem.version))
  (if (not (= observed editor-observation)) {
    (set editor-observation observed)
    (set diagnostics.props.value (if (= model.error "") "No errors." model.error))
    (set path-label.props.value (if (= model.path "") "(no file open)" model.path))
    (set status-label.props.value model.status)
    (set status-label.props.color (if (= model.status "Saved") Theme.green
      (if model.error Theme.pink Theme.orange)))
    (set preview-label.props.value $"{preview.path} | {preview.mime} | {preview.size} bytes")
    (set reopen-prompt.props.visible (bool model.confirm-reopen))
    (ui-invalidate desktop)
  })
  (if (>= inspect-elapsed Theme.inspect-delay) {
    (set inspect-elapsed 0)
    (Inspector.refresh desktop inspector)
  })
  (ui-render desktop context))
