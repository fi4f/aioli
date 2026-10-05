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

; Direct shader math + immediate drawing.
(defpixel render [p time]
  (let [wave (+ (sin (+ (* p.x 0.04) time))
               (cos (- (* p.y 0.05) time)))
        rings (sin (- (* (length (- p [160 120]))
                         0.07) time))]
    (background
      (rgb (+ 0.08 (* 0.06 wave))
           (+ 0.30 (* 0.15 rings))
           (+ 0.26 (* 0.10 wave)))))
  (scope
    (translate [160 120])
    (rotate (* time 0.2))
    (fill (param :accent))
    (opacity (param :glow))
    (repeat 8 i
      (scope
        (rotate (* i 0.7854))
        (rect [30 -1] [55 2]))))
  (fill "#ecedc3")
  (circle [(param :x) (param :y)] 4))
