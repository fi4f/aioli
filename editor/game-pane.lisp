; Fit the logical game canvas continuously, using the available pane space.
(defn game-pane [world-x world-width h]
  (let [scale (max 0.01 (min (/ (max 1 (- world-width 16)) 320) (/ (max 1 (- h 132)) 240)))
        sw (* 320 scale) sh (* 240 scale)
        sx (+ world-x (/ (- world-width sw) 2))
        sy (+ 100 (/ (- (- h 140) sh) 2))]
    (fill (get :ui-muted))
    (scope (clip [(+ world-x 8) 66] [(max 0 (- world-width 160)) 20])
      (text [(+ world-x 8) 66] (preview-path)))
    (when (ui-button :focus-preview (if (get :preview-focused) "Restore / F4" "Focus / F4")
                    [(+ world-x (max 0 (- world-width 144))) 58] [(min 136 world-width) 32]
                    (get :preview-focused))
      (toggle-preview-focus))
    (surface [sx sy] [sw sh])))
