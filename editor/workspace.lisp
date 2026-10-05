; Fullscreen workspace composition; panes are independent imported Lisp files.
(import "./theme.lisp")
(import "./ui/components.lisp")
(import "./state.lisp")
(import "./code-pane.lisp")
(import "./game-pane.lisp")
(import "./parameter-pane.lisp")
(import "./tool-window.lisp")
(import "./files-pane.lisp")
(import "./filename-dialog.lisp")
(import "./file-context-menu.lisp")
(import "./command-palette.lisp")
(import "./generator-window.lisp")
(import "./menu-bar.lisp")
(import "./about.lisp")
(import "./canvas-settings.lisp")
(import "./asset-preview.lisp")

(defn editor []
  ; Keep older command programs that used the modal explorer key working.
  (when (= (get :window) "files") (set! :show-files true) (set! :window ""))
  (let [w (screen-width) h (screen-height)
        focused (get :preview-focused)
        narrow (< w (get :ui-narrow-width))
        files-expanded (and (get :show-files) (not (get :files-collapsed)))
        files-width (if (and (not focused) (get :show-files)) (if (get :files-collapsed) (get :ui-collapsed-width) (if narrow w (get :ui-files-width))) 0)
        code-visible (and (not focused) (get :show-code) (or (not narrow) (not files-expanded)))
        tools-width (if (and (not focused) (get :show-tools))
                        (if (get :inspector-collapsed) (get :ui-collapsed-width) (if narrow 0 (get :ui-inspector-width))) 0)
        code-width (if code-visible
                       (if (get :code-collapsed) (get :ui-collapsed-width)
                         (if narrow (- w files-width tools-width) (floor (* (- w files-width) (get :ui-code-fraction))))) 0)
        code-expanded (and code-visible (not (get :code-collapsed)))
        world-x (+ files-width code-width)
        world-width (- w files-width code-width tools-width)]
    (background (get :ui-bg))
    (fill (get :ui-text))
    (when (> w 500) (text [(- w 80) 18] "aioli"))

    ; The menu bar is the single home for workspace actions.
    (editor-menu-bar)
    (fill (get :ui-border)) (rect [0 50] [w 1])

    (when (and (not focused) (get :show-files)) (file-explorer 0 51 files-width (- h 81)))

    (when code-visible (code-pane files-width code-width h))

    (when (and (> world-width 0) (or focused (not narrow) (and (not code-expanded) (not files-expanded))))
      (game-pane world-x world-width h))

    (when (and (not focused) (get :show-tools)) (parameter-pane w h narrow tools-width))

    ; Overlay widgets paint last, giving their regions pointer priority.
    (when (and (not focused) (not (= (get :window) "")))
      (if (= (get :window) "canvas-settings") (canvas-settings-window)
      (if (= (get :window) "about") (about-aioli)
        (if (= (get :window) "file-path") (file-path-dialog)
          (if (or (= (get :window) "image-asset") (= (get :window) "audio-asset") (= (get :window) "text-asset"))
            (asset-preview-window) (project-window))))))
    (when (not (= (file-drag-path) ""))
      (scope
        (fill (get :ui-selection)) (rect [(+ (pointer-x) 12) (+ (pointer-y) 12)] [240 30])
        (fill (get :ui-text))
        (text [(+ (pointer-x) 20) (+ (pointer-y) 18)] (file-drag-path))))
    ; Dropdowns paint last so their input regions cover panes and tool windows.
    (when (get :menu) (editor-menu (screen-width) (screen-height)))
    (when (and (not focused) (get :file-context)) (file-context-menu w h))

    (fill (get :ui-bg)) (rect [0 (- h 30)] [w 30])
    (fill (if (error?) (get :ui-error) (get :ui-muted)))
    (scope (clip [24 (- h 24)] [(- w 240) 20])
      (text [24 (- h 22)] (status)))
    (when (error?)
      (region :diagnostic "View error details" [0 (- h 30)] [(- w 210) 30])
      (when (or (activated? :diagnostic)
                (and (pointer-pressed?) (hit? [0 (- h 30)] [(- w 210) 30])))
        (set! :tab "diagnostic") (set! :show-code true)))
    (fill (get :ui-muted))
    (text [(- w 186) (- h 22)] "Ctrl+Enter to run")))
