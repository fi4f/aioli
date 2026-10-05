; Game preview is sampled among pixel UI primitives.
(defn game-pane [world-x world-width h]
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
