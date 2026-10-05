; editor/tool-window.lisp / live Lisp drawing and interaction.
(defn project-window []
  (let [kind (get :window)
        w (min (if (= kind "palette") 720 960) (- (screen-width) 32))
        h (min (if (= kind "palette") 480 (if (> w 760) 580 690)) (- (screen-height) 100))
        x (/ (- (screen-width) w) 2) y 64]
    ; This region intercepts background clicks without consuming child controls.
    (region :window "Project tool window" [x y] [w h])
    (fill "#0b100d") (rect [(- x 2) (- y 2)] [(+ w 4) (+ h 4)])
    (fill (get :ui-panel)) (rect [x y] [w h])
    (fill (get :ui-text))
    (text [(+ x 16) (+ y 12)]
      (if (= kind "palette") "Commands / Ctrl+Shift+P"
        (if (= kind "image") "Image generator / 320 x 240" "Audio generator")))
    (when (ui-button :close-window "Close" [(+ x w -84) (+ y 4)] [76 32] false)
      (set! :window ""))
    (scope
      (clip [x (+ y 42)] [w (- h 42)])
      (if (= kind "palette") (command-palette x (+ y 48) w (- h 48))
        (generator-window kind x (+ y 48) w (- h 48))))))
