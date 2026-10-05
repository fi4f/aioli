; Optional gameplay parameter pane, assembled from reusable pixel controls.
(defn parameter-pane [w h narrow tools-width]
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
