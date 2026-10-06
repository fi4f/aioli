; editor/tool-window.lisp / live Lisp drawing and interaction.
(defn project-window []
  (let [kind (if (and (= (get :window) "") (get :show-generator)) "generator" (get :window))
        w (min (if (= kind "palette") 720 960) (- (screen-width) 32))
        h (min (if (= kind "palette") 480 (if (and (= kind "generator") (get :generator-collapsed)) 48 720)) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2)
        y (if (= kind "generator")
            (if (get :generator-collapsed) (- (screen-height) h 30)
              (max 51 (+ 51 (/ (- (screen-height) 81 h) 2)))) 64)]
    ; This region intercepts background clicks without consuming child controls.
    (region :window "Project tool window" [x y] [w h])
    (fill (get :ui-shadow)) (rect [(- x 2) (- y 2)] [(+ w 4) (+ h 4)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (fill (get :ui-text))
    (text [(+ x 16) (+ y 12)]
      (if (= kind "palette") "Commands / Ctrl+Shift+P" (generator-title)))
    (when (ui-close-button :close-window "Close preview" [(+ x w -40) (+ y 4)] [32 32])
      (if (= kind "generator") (close-generator) (set! :window "")))
    (when (= kind "generator")
      (when (ui-chevron-button :collapse-generator (if (get :generator-collapsed) "Expand generator" "Collapse generator")
                (if (get :generator-collapsed) "u" "d") [(+ x w -76) (+ y 4)] [32 32])
        (toggle-generator-collapse)))
    (scope
      (clip [x (+ y 42)] [w (- h 42)])
      (if (= kind "palette") (command-palette x (+ y 48) w (- h 48))
        (generator-pane-content [x (+ y 48)] [w (- h 48)])))))


; Each hook can be inspected without running the scene's draw/update lifecycle.
(defn hook-pane-content [origin size]
  (let [kind (get :preview-kind)]
    (ui/render origin size
      (ui/column (map :padding 12 :gap 8)
        [(ui/row (map :gap 8)
           [(ui/button :back-to-hooks "Code" (fn [] (back-to-hooks)))
            (ui/with (map :grow 1) (ui/muted (str "Arguments: " (hook-parameters))))])
         (ui/input :hook-args "Hook arguments / JSON array" :__hookArgs)
         (ui/button :refresh-hook-preview "Preview" (fn [] (refresh-hook-preview)))
         (ui/custom (map :grow 1)
           (fn [p s]
             (if (= kind "hook-draw")
               (do (fill (get :ui-shadow)) (rect p s) (hook-draw-preview p s))
               (audio-asset-content p s true))))]))))
