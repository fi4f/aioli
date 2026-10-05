; editor/graphics-tools.lisp / live Lisp drawing and interaction.
(defn graphics-tools [x y width]
  (ui-number-slider :moon "Moon radius" :moon x y width 4 40)
  (ui-number-slider :wind "Wind" :wind x (+ y 62) width 0 10)
  (ui-slider :glow "Glow" :glow x (+ y 124) width 0 1)
  (ui-number-slider :speed "Walk speed" :speed x (+ y 186) width 20 160)
  (when (ui-button :palette "Cycle palette" [x (+ y 248)] [width 32] false)
    (set! :accent (if (= (get :accent) "#c4ef9b") "#e9bca9"
                     (if (= (get :accent) "#e9bca9") "#9fc8e7" "#c4ef9b"))))
  (scope
    (fill (get :accent))
    (rect [(+ x width -28) (+ y 256)] [16 16]))
  (when (ui-button :center "Center player" [x (+ y 292)] [width 32] false)
    (set! :x 160) (set! :y 190) (set! :vy 0)))
