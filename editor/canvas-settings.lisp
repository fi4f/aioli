; Components own positioning, painting and input; this file describes the tool.
(defn canvas-settings-window []
  (ui/dialog :canvas-settings-panel "Canvas size / pixels" 480 280
    (ui/column (map :gap 12)
      [(ui/muted "Width / height")
       (ui/code :__canvasSize)
       (ui/row (map :gap 8)
         [(ui/button :canvas-retro "320x240" (fn [] (canvas-preset 320 240)))
          (ui/button :canvas-wide "640x360" (fn [] (canvas-preset 640 360)))
          (ui/button :canvas-square "512x512" (fn [] (canvas-preset 512 512)))])
       (ui/muted "Whole numbers / 16 to 2048 pixels")
       (ui/row (map) [(ui/button :canvas-apply "Apply" (fn [] (apply-canvas-settings)))])])))
