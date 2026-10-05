; editor/generator-window.lisp / live Lisp drawing and interaction.
(defn generator-window [kind x y w h]
  (let [wide (> w 760) left (if wide (floor (* w 0.55)) w)
        gx (if wide (+ x left 16) (+ x 16))
        gy (if wide y (+ y 220)) gw (if wide (- w left 32) (- w 32))
        code-height (if wide (- h 16) 200)]
    (code-editor [(+ x 16) y] [(- left 32) code-height]
      (if (= kind "image") "generators/image.lisp" "generators/audio.lisp"))
    (if (= kind "image")
      (let [preview-width (min gw (if wide 320 160)) preview-height (* preview-width 0.75)
            gy (+ gy 36)]
        (init! :image-shape 0)
        (when (ui-button :image-shape-control
                  (if (= (get :image-shape) 0) "Circle" (if (= (get :image-shape) 1) "Square" "Line"))
                  [gx (- gy 36)] [112 28] false)
          (set! :image-shape (mod (+ (get :image-shape) 1) 3)))
        (image-preview [gx gy] [preview-width preview-height])
        (ui-number-slider :image-radius-control "Radius" :image-radius gx (+ gy preview-height 12) gw 1 120)
        (ui-number-slider :image-x-control "X" :image-x gx (+ gy preview-height 66) gw 0 320)
        (ui-number-slider :image-y-control "Y" :image-y gx (+ gy preview-height 120) gw 0 240)
        (when (ui-button :image-color-control "Color" [gx (+ gy preview-height 176)] [72 28] false)
          (set! :image-color (if (= (get :image-color) "#bbd6a6") "#e9bca9" "#bbd6a6")))
        (when (ui-button :image-store "Keep" [(+ gx 80) (+ gy preview-height 176)] [72 28] false) (save-image-resource))
        (when (ui-button :image-export "PNG" [(+ gx 160) (+ gy preview-height 176)] [72 28] false) (export-image)))
      (do
        (ui-choice :sound-wave-control "Wave" :sound-wave ["sine" "triangle" "square" "sawtooth" "noise"] gx gy gw)
        (ui-number-slider :sound-pitch-control "Start Hz" :sound-pitch gx (+ gy 38) gw 40 1600)
        (ui-number-slider :sound-end-control "End Hz" :sound-end gx (+ gy 92) gw 40 1600)
        (ui-number-slider :sound-duration-control "Seconds" :sound-duration gx (+ gy 146) gw 0.05 2)
        (ui-slider :sound-gain-control "Gain" :sound-gain gx (+ gy 200) gw 0 1)
        (scope (fill (get :ui-accent)) (waveform [gx (+ gy 254)] [gw 48] true))
        (when (ui-button :sound-preview "Play" [gx (+ gy 316)] [72 28] false) (play-generated-sound))
        (when (ui-button :sound-store "Keep" [(+ gx 80) (+ gy 316)] [72 28] false) (save-sound-resource))
        (when (ui-button :sound-export "WAV" [(+ gx 160) (+ gy 316)] [72 28] false) (export-sound))))))
