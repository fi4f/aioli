; Fullscreen workspace composition; panes are independent imported Lisp files.
(import "../ui/components.lisp")
(import "./state.lisp")
(import "./code-pane.lisp")
(import "./game-pane.lisp")
(import "./parameter-pane.lisp")
(import "./graphics-tools.lisp")
(import "./sound-tools.lisp")
(import "./tool-window.lisp")
(import "./files-pane.lisp")
(import "./filename-dialog.lisp")
(import "./file-context-menu.lisp")
(import "./command-palette.lisp")
(import "./generator-window.lisp")
(import "./menu-bar.lisp")
(import "./about.lisp")
(import "./asset-preview.lisp")

(defn editor []
  ; Keep older command programs that used the modal explorer key working.
  (when (= (get :window) "files") (set! :show-files true) (set! :window ""))
  (let [w (screen-width) h (screen-height)
        narrow (< w 850)
        files-width (if (get :show-files) (if narrow w 280) 0)
        code-visible (and (get :show-code) (or (not narrow) (not (get :show-files))))
        code-width (if code-visible
                       (if narrow w (floor (* (- w files-width) 0.42))) 0)
        tools-width (if (and (get :show-tools) (not narrow)) 264 0)
        world-x (+ files-width code-width)
        world-width (- w files-width code-width tools-width)]
    (background (get :ui-bg))
    (fill (get :ui-text))
    (when (> w 500) (text [(- w 80) 18] "aioli"))

    ; The menu bar is the single home for workspace actions.
    (editor-menu-bar)
    (fill "#27312a") (rect [0 50] [w 1])

    (when (get :show-files) (file-explorer 0 51 files-width (- h 81)))

    (when code-visible (code-pane files-width code-width h))

    (when (and (> world-width 0) (or (not narrow) (and (not (get :show-code)) (not (get :show-files)))))
      (game-pane world-x world-width h))

    (when (get :show-tools) (parameter-pane w h narrow tools-width))

    ; Overlay widgets paint last, giving their regions pointer priority.
    (when (not (= (get :window) ""))
      (if (= (get :window) "about") (about-aioli)
        (if (= (get :window) "file-path") (file-path-dialog)
          (if (or (= (get :window) "image-asset") (= (get :window) "audio-asset"))
            (asset-preview-window) (project-window)))))
    ; Dropdowns paint last so their input regions cover panes and tool windows.
    (when (get :menu) (editor-menu (screen-width) (screen-height)))
    (when (get :file-context) (file-context-menu w h))

    (fill (get :ui-bg)) (rect [0 (- h 30)] [w 30])
    (fill (if (error?) "#e8ac94" (get :ui-muted)))
    (scope (clip [24 (- h 24)] [(- w 240) 20])
      (text [24 (- h 22)] (status)))
    (when (error?)
      (region :diagnostic "View error details" [0 (- h 30)] [(- w 210) 30])
      (when (or (activated? :diagnostic)
                (and (pointer-pressed?) (hit? [0 (- h 30)] [(- w 210) 30])))
        (set! :tab "diagnostic") (set! :show-code true)))
    (fill (get :ui-muted))
    (text [(- w 186) (- h 22)] "Ctrl+Enter to run")))
