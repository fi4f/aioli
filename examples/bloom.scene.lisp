; init! sets defaults only when state is absent.
; Hot edits preserve the running world.
(init! :x 160 ["Player X" 6 314 1])
(init! :y 190 ["Player Y" 0 240 1])
(init! :vy 0 ["Vertical speed" -200 320 1])
(init! :speed 75 ["Walk speed" 20 160 1])
(init! :wind 3 ["Wind" 0 10 0.1])
(init! :moon 20 ["Moon radius" 4 40 1])
(init! :glow 0.65 ["Glow" 0 1 0.01])
(init! :accent "#c4ef9b" ["Palette"])
(init! :pitch 440 ["Start Hz" 40 1200 1])
(init! :end-pitch 880 ["End Hz" 40 1600 1])
(init! :duration 0.3 ["Duration" 0.05 1 0.01])
(init! :volume 0.35 ["Gain" 0 0.6 0.01])
(init! :wave "sine" ["Wave" ["sine" "triangle" "square" "sawtooth" "noise"]])
(init! :overtone true ["Mix overtone"])

(defn update [dt]
  (when (or (key? "ArrowLeft") (key? "a"))
    (set! :x (- (get :x) (* (get :speed) dt))))
  (when (or (key? "ArrowRight") (key? "d"))
    (set! :x (+ (get :x) (* (get :speed) dt))))
  (set! :x (clamp (get :x) 6 314))

  (when (and (or (key? " ") (key? "w")
                 (key? "ArrowUp"))
             (>= (get :y) 190))
    (set! :vy -130)
    (play-sound))

  (set! :vy (+ (get :vy) (* 320 dt)))
  (set! :y (+ (get :y) (* (get :vy) dt)))
  (when (> (get :y) 190)
    (set! :y 190)
    (set! :vy 0)))

; A patch is an ordinary Lisp function.
; Each voice mixes into one procedural buffer.
; waveform, start Hz, end Hz, duration, gain
(defn sound []
  (voice (get :wave)
         (get :pitch)
         (get :end-pitch)
         (get :duration)
         (get :volume))
  (when (get :overtone)
    (voice :triangle
           (* (get :pitch) 0.5)
           (* (get :end-pitch) 0.5)
           (get :duration)
           (* (get :volume) 0.25))))

; A procedural bloom: transform, mix, glow.
(defpixel render [p time]
  (background "#101b25")
  (translate [160 120])
  (scope
    (blend :add)
    (opacity (param :glow))
    (repeat 16 i
      (scope
        (rotate (+ (* i 0.3927) (* time 0.15)))
        (fill (mix [0.2 0.5 0.7]
                   [0.8 0.9 0.4]
                   (/ i 16)))
        (circle [(+ 40 (* 12 (sin time))) 0]
                (+ 15 (* 5 (sin (+ time i))))))))
  (fill (param :accent))
  (circle [0 0] (param :moon))
  (fill "#101b25")
  (circle [4 -4] (* (param :moon) 0.7)))
