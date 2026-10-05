(generator :audio "Tone")
(init! :sound-wave "sine" ["Wave" ["sine" "triangle" "square" "sawtooth" "noise"]])
(init! :sound-pitch 440 ["Start Hz" 40 1600 1])
(init! :sound-end 880 ["End Hz" 40 1600 1])
(init! :sound-duration 0.3 ["Seconds" 0.05 2 0.01])
(init! :sound-gain 0.35 ["Gain" 0 1 0.01])
(defn generate-sound []
  (voice (get :sound-wave) (get :sound-pitch) (get :sound-end)
         (get :sound-duration) (get :sound-gain)))
