; editor/sound-tools.lisp / live Lisp drawing and interaction.
(defn sound-tools [x y width]
  (ui-choice :wave "Wave" :wave ["sine" "triangle" "square" "sawtooth" "noise"]
             x y width)
  (ui-number-slider :pitch "Start Hz" :pitch x (+ y 50) width 40 1200)
  (ui-number-slider :end-pitch "End Hz" :end-pitch x (+ y 112) width 40 1600)
  (ui-number-slider :duration "Duration" :duration x (+ y 174) width 0.05 1)
  (ui-slider :volume "Gain" :volume x (+ y 236) width 0 0.6)
  (ui-toggle :overtone "Mix overtone" :overtone x (+ y 298) width)
  (scope (fill (get :ui-accent)) (waveform [x (+ y 344)] [width 48]))
  (when (ui-button :audition "Play" [x (+ y 410)] [90 32] false) (play-sound))
  (when (ui-button :wav "Save WAV" [(+ x 100) (+ y 410)] [(- width 100) 32] false)
    (export-wav)))
