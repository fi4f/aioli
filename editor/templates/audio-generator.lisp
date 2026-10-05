(generator :audio "New sound")
(init! :pitch 440 ["Pitch" 40 2000 1])
(init! :duration 0.3 ["Seconds" 0.05 2 0.01])
(init! :gain 0.35 ["Gain" 0 1 0.01])
(defn generate-sound []
  (voice :sine (get :pitch) (get :pitch) (get :duration) (get :gain)))
