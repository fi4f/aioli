; Components own positioning, painting and input; this file describes the tool.
(defn project-settings-window []
  (ui/dialog :project-settings-panel "Project Settings" 520 440
    (ui/column (map :gap 12)
      [(ui/label "Name")
       (ui/input :project-name "Project name" :__projectName)
       (ui/label "Canvas / pixels")
       (ui/row (map :gap 12)
         [(ui/column (map :grow 1 :gap 6)
            [(ui/muted "Width") (ui/input :canvas-width "Canvas width" :__canvasWidth)])
          (ui/column (map :grow 1 :gap 6)
            [(ui/muted "Height") (ui/input :canvas-height "Canvas height" :__canvasHeight)])])
       (ui/row (map :gap 8)
         [(ui/button :canvas-retro "320x240" (fn [] (project-canvas-preset 320 240)))
          (ui/button :canvas-wide "640x360" (fn [] (project-canvas-preset 640 360)))
          (ui/button :canvas-square "512x512" (fn [] (project-canvas-preset 512 512)))])
       (ui/muted "Whole numbers / 16 to 2048 pixels")
       (ui/with (map :grow 1) (ui/muted (get :project-settings-error)))
       (ui/row (map :gap 8)
         [(ui/button :canvas-apply "Apply" (fn [] (apply-project-settings)))
          (ui/button :settings-cancel "Cancel" (fn [] (set! :window "")))])])))

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
