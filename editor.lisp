; The editor is a fullscreen aioli app: all in one lisp.
; Layout, paint, controls, and interactions all live here.
(init! :ui-bg "#101613")
(init! :ui-panel "#171e19")
(init! :ui-text "#d0dbd2")
(init! :ui-muted "#77867b")
(init! :ui-accent "#bbd6a6")
(init! :tab "scene")
(init! :show-code true)
(init! :show-tools false)
(init! :tool "graphics")
(init! :file-context false)
(init! :context-x 8)
(init! :context-y 90)
(init! :context-kind "")
(init! :context-path "")
(init! :file-operation "create")
(init! :menu false)
(when (= (get :menu) true) (set! :menu false))
(init! :paused false)
(init! :window "")
(init! :file-offset 0)
(init! :selected-file "scene.lisp")
(init! :show-files false)
(init! :file-path-editing false)
(init! :open-folders "[]")
; Upgrade a saved modal explorer into the docked pane.
(when (= (get :window) "files") (set! :show-files true) (set! :window ""))

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

    (when code-visible
      (fill (get :ui-panel))
      (rect [files-width 51] [code-width (- h 81)])
      (ui-tab "scene" "scene" (+ files-width 16) (get :tab))
      (when (> code-width 165) (ui-tab "game" "game" (+ files-width 90) (get :tab)))
      (when (> code-width 239) (ui-tab "audio" "audio" (+ files-width 164) (get :tab)))
      (when (> code-width 313) (ui-tab "editor" "editor" (+ files-width 238) (get :tab)))
      (when (> code-width 385)
        (ui-tab "ui" "ui" (+ files-width 312) (get :tab)))
      (if (and (= (get :window) "") (not (and (get :show-files) (get :file-path-editing))))
        (code-editor [(+ files-width 16) 110] [(- code-width 32) (- h 158)] (get :tab))
        (do (fill (get :ui-muted)) (text [(+ files-width 24) 114] "Tool input active")))
      (when (not (or (= (get :tab) "scene") (= (get :tab) "game")
                     (= (get :tab) "audio") (= (get :tab) "editor") (= (get :tab) "ui")))
        (fill (get :ui-muted)) (text [(+ files-width 24) 94] (get :tab))))

    (when (and (> world-width 0) (or (not narrow) (and (not (get :show-code)) (not (get :show-files)))))
      (let [scale (max 0.3 (min 3 (floor
                    (min (/ (- world-width 64) 320) (/ (- h 190) 240)))))
            sw (* 320 scale) sh (* 240 scale)
            sx (+ world-x (/ (- world-width sw) 2))
            sy (+ 88 (/ (- (- h 170) sh) 2))]
        (fill (get :ui-muted))
        (text [sx (- sy 30)] "Midnight garden")
        (surface [sx sy] [sw sh])
        (fill (get :ui-muted))
        (text [sx (+ sy sh 18)] "A/D to move  /  Space to jump")))

    (when (get :show-tools)
      (let [x (if narrow (- w 264) (- w tools-width)) y 76]
        (fill (get :ui-panel))
        (rect [x 51] [264 (- h 81)])
        (when (ui-button :graphics "Graphics" [(+ x 16) y] [108 32]
                         (= (get :tool) "graphics")) (set! :tool "graphics"))
        (when (ui-button :sound "Sound" [(+ x 132) y] [108 32]
                         (= (get :tool) "sound")) (set! :tool "sound"))
        (scope
          (clip [(+ x 16) 126] [232 (- h 160)])
          (if (= (get :tool) "graphics")
              (graphics-tools (+ x 16) 136 232)
              (sound-tools (+ x 16) 136 232)))))

    ; Overlay widgets paint last, giving their regions pointer priority.
    (when (not (= (get :window) ""))
      (if (= (get :window) "about") (about-aioli)
        (if (= (get :window) "file-path") (file-path-dialog) (project-window))))
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
