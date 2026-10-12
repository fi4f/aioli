; The editor is composed from ordinary, editable Lisp UI components.
; Library: hg/ui.lisp. Source control: editor/code-editor.lisp.
(await (import "../hg/ui.lisp"))
(let Editor (await (import "./code-editor.lisp")))
(let state app.state)
(if (= state.editor nil) (set state.editor (dict
  "source" app.source "anchor" 0 "head" 0 "scroll" 0 "version" 0
  "composing" false "pending" false "elapsed" 0 "error" "" "auto" true)))
(let model state.editor)
(if (= state.layout nil) (set state.layout (dict)))
(let desktop nil)
(let workspace nil)
(let diagnostics nil)
(let inspector nil)
(let inspect-elapsed 1)
(let editor-observation nil)

(let apply-draft (fn ()
  (set model.pending false)
  (set model.error "")
  (let requested model.version)
  (promise (patch-source model.source)
    catch (error) {
      (if (= requested model.version) (set model.error error.message))
    })))

(let build-editor (fn ()
  (set diagnostics (label "" (ui-style (dict "font" "monospace" "size" 13
    "color" (vec4 1 0.65 0.6 1)))))
  (set inspector (label "" (ui-style (dict "font" "monospace" "size" 12))))
  (set workspace (ui-dock
    (ui-style (dict "layout" state.layout))
    (ui-pane "Source"
      (Editor.code-editor model
        (on change (event) {
          (set model.pending true)
          (set model.elapsed 0)
        })))
    (ui-pane "Bindings" inspector)
    (ui-pane "Diagnostics" diagnostics)))
  (ui-new (ui-vbox (ui-style (dict "gap" 0))
    (ui-menu
      (label "Mayo" (ui-style (dict "size" 18 "padding" 4)))
      (ui-dropdown "File"
        (button "Apply source" (on click () (apply-draft)))
        (button "Reset draft" (on click () {
          (set model.source app.source)
          (set model.anchor 0)
          (set model.head 0)
          (set model.pending false)
        })))
      (ui-dropdown "View"
        (button "Reset layout" (on click () {
          (set state.layout (dict))
          (patch-source app.source)
        }))
        (button "Restore minimized panes" (on click (event) {
          (for pane workspace.state.panes
            (if pane.state.minimized (ui-pane-restore event.ui pane)))
        })))
      (button (if model.auto "Auto reload: on" "Auto reload: off")
        (on click (event) {
          (set model.auto (not model.auto))
          (set event.current-target.props.value
            (if model.auto "Auto reload: on" "Auto reload: off"))
        }))
      (label "Drag pane titles to dock; wheel to scroll bars"
        (ui-style (dict "size" 12 "padding" 6))))
    workspace
    (ui-taskbar workspace (label "Minimized" (ui-style (dict "size" 12 "padding" 4))))))))

(on attach ()
  (set desktop (build-editor))
  (set desktop.observe false)
  (set inspect-elapsed 1)
  (set desktop.scale (or state.pixel-ratio 1))
  (ui-mount desktop))
(on detach () (if desktop (ui-unmount desktop)))

(on update (context)
  (ui-update desktop context)
  (set inspect-elapsed (+ inspect-elapsed context.dt))
  (if (and model.auto model.pending (not model.composing)) {
    (set model.elapsed (+ model.elapsed context.dt))
    (if (>= model.elapsed 0.4) (apply-draft))
  }))

(on render (context)
  (set desktop.scale (or state.pixel-ratio 1))
  ; Observe the editor model explicitly; idle frames need no tree walk or layout.
  (let observed (list model.source model.anchor model.head model.scroll model.error))
  (if (not (= observed editor-observation)) {
    (set editor-observation observed)
    (set diagnostics.props.value (if (= model.error "") "No errors." model.error))
    (ui-invalidate desktop)
  })
  (if (>= inspect-elapsed 0.25) {
    (set inspect-elapsed 0)
    (let handles (App.inspect app))
    (let summary "")
    (for name (keys handles) {
      (let value (App.read app (get handles.(get name))))
      (set summary $"{summary}{name}: {(type value)}\n")
    })
    (if (not (= inspector.props.value summary)) {
      (set inspector.props.value summary)
      (ui-invalidate desktop)
    })
  })
  (ui-render desktop context))

(on pointerdown (event) (ui-input desktop "pointerdown" event))
(on pointermove (event) (ui-input desktop "pointermove" event))
(on pointerup (event) (ui-input desktop "pointerup" event))
(on pointercancel (event) (ui-input desktop "pointercancel" event))
(on pointerleave (event) (ui-input desktop "pointerleave" event))
(on wheel (event) (ui-input desktop "wheel" event))
(on keydown (event) (ui-input desktop "keydown" event))
(on keyup (event) (ui-input desktop "keyup" event))
