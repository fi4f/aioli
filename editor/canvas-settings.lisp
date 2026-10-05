; Project resolution is measured in logical pixels; previews preserve its aspect ratio.
(defn canvas-settings-window []
  (let [w (min 480 (- (screen-width) 32)) x (/ (- (screen-width) w) 2) y 80]
    (region :canvas-settings-panel "Canvas size" [x y] [w 280])
    (fill (get :ui-border)) (rect [(- x 1) (- y 1)] [(+ w 2) 282])
    (fill (get :ui-panel)) (rect [x y] [w 280])
    (fill (get :ui-text)) (text [(+ x 16) (+ y 16)] "Canvas size / logical pixels")
    (when (ui-close-button :close-window "Cancel canvas size" [(+ x w -40) (+ y 8)] [32 32]) (set! :window ""))
    (fill (get :ui-muted)) (text [(+ x 16) (+ y 60)] "Width / height")
    (code-editor [(+ x 16) (+ y 92)] [(- w 32) 32] :__canvasSize)
    (when (ui-button :canvas-retro "320x240" [(+ x 16) (+ y 156)] [104 32] false) (canvas-preset 320 240))
    (when (ui-button :canvas-wide "640x360" [(+ x 128) (+ y 156)] [104 32] false) (canvas-preset 640 360))
    (when (ui-button :canvas-square "512x512" [(+ x 240) (+ y 156)] [104 32] false) (canvas-preset 512 512))
    (fill (get :ui-muted)) (text [(+ x 16) (+ y 204)] "Whole numbers / 16 to 2048 pixels")
    (when (ui-button :canvas-apply "Apply" [(+ x 16) (+ y 236)] [96 32] false) (apply-canvas-settings))))
