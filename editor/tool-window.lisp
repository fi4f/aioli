; editor/tool-window.lisp / live Lisp drawing and interaction.
(defn project-window []
  (let [kind (get :window)
        w (min (if (= kind "palette") 720 960) (- (screen-width) 32))
        h (min (if (= kind "palette") 480 720) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2) y 64]
    ; This region intercepts background clicks without consuming child controls.
    (region :window "Project tool window" [x y] [w h])
    (fill (get :ui-shadow)) (rect [(- x 2) (- y 2)] [(+ w 4) (+ h 4)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (fill (get :ui-text))
    (text [(+ x 16) (+ y 12)]
      (if (= kind "palette") "Commands / Ctrl+Shift+P"
        (if (or (= kind "hooks") (= kind "hook-draw") (= kind "hook-sound")) (hook-title)
          (generator-title))))
    (when (ui-close-button :close-window "Close preview" [(+ x w -40) (+ y 4)] [32 32])
      (set! :window ""))
    (scope
      (clip [x (+ y 42)] [w (- h 42)])
      (if (= kind "palette") (command-palette x (+ y 48) w (- h 48))
        (if (or (= kind "hooks") (= kind "hook-draw") (= kind "hook-sound"))
          (hook-window kind x (+ y 48) w (- h 48))
          (generator-window kind x (+ y 48) w (- h 48)))))))


; Each hook can be inspected separately from the game's draw/update lifecycle.
(defn hook-window [kind x y w h]
  (init! :hook-offset 0)
  (if (= kind "hooks")
    (let [hooks (source-hooks) height (- h 16)
          offset (ui-inspector-scroll :hook-list-scroll :hook-offset (+ x 16) y (- w 32) height (* (count hooks) 48))]
      (scope (clip [(+ x 16) y] [(- w 48) height])
        (repeat (count hooks) i
          (let [hook (nth hooks i) name (nth hook 0)]
            (when (ui-button (str "inspect-hook-" name) (str (nth hook 1) " / " (nth hook 2))
                             [(+ x 16) (+ y (* i 48) (- 0 offset))] [(- w 56) 40] false)
              (inspect-hook name))))))
    (do
      (when (ui-button :back-to-hooks "Code" [(+ x 16) y] [80 32] false) (back-to-hooks))
      (fill (get :ui-muted))
      (scope (clip [(+ x 108) (+ y 8)] [(- w 124) 20])
        (text [(+ x 108) (+ y 8)] (str "Arguments: " (hook-parameters))))
      (code-editor [(+ x 16) (+ y 40)] [(- w 160) 32] :__hookArgs)
      (when (ui-button :refresh-hook-preview "Preview" [(+ x w -132) (+ y 40)] [116 32] false)
        (refresh-hook-preview))
      (if (= kind "hook-draw")
        (let [origin [(+ x 16) (+ y 88)] size [(- w 32) (- h 104)]]
          (fill (get :ui-shadow)) (rect origin size)
          (hook-draw-preview origin size))
        (do
          (audio-asset-view x (+ y 66) w (- h 66))
          (when (ui-button :hook-forward "+1 sec" [(+ x 224) (+ y h -48)] [88 32] false)
            (seek-asset (min (asset-duration) (+ (asset-time) 1)))))))))
